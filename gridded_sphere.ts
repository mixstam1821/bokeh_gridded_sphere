import * as p from "core/properties"
import {LayoutDOM, LayoutDOMView} from "models/layouts/layout_dom"
import {div} from "core/dom"
import {projectSphere} from "./projections"
import {getPalette, valueToColor, getValueRange} from "./palettes"

interface Quad {
  depth: number
  points: Array<{x: number, y: number}>
  color: string
}

interface ScatterPoint {
  lon: number
  lat: number
  size?: number
  color?: string
  border_color?: string
  border_width?: number
  label?: string
}

interface Line {
  coords: Array<[number, number]>
  color?: string
  width?: number
  label?: string
}

interface Bar {
  lon: number
  lat: number
  height: number
  width?: number
  color?: string
  border_color?: string
  border_width?: number
  label?: string
}

interface Trajectory {
  coords: Array<{lon: number, lat: number, altitude: number}>
  color?: string
  width?: number
  show_points?: boolean
  point_size?: number
  point_color?: string
  label?: string
}

export class GriddedSphereView extends LayoutDOMView {
  declare model: GriddedSphere

  private container_el?: HTMLDivElement
  private canvas?: HTMLCanvasElement
  private ctx?: CanvasRenderingContext2D
  private colorbar_canvas?: HTMLCanvasElement
  private colorbar_ctx?: CanvasRenderingContext2D
  private tooltip_el?: HTMLDivElement
  private mouse_x: number = 0
  private mouse_y: number = 0
  
  private is_dragging: boolean = false
  private drag_start_x: number = 0
  private drag_start_y: number = 0
  private drag_start_rotation: number = 0
  private drag_start_tilt: number = 0
  
  private animation_id?: number
  private rotation_resume_timeout?: number

  override get child_models(): LayoutDOM[] {
    return []
  }

  override connect_signals(): void {
    super.connect_signals()
    
    this.connect(this.model.properties.rotation.change, () => this.render_sphere())
    this.connect(this.model.properties.tilt.change, () => this.render_sphere())
    this.connect(this.model.properties.zoom.change, () => this.render_sphere())
    this.connect(this.model.properties.palette.change, () => {
      this.render_sphere()
      this.render_colorbar()
    })
    this.connect(this.model.properties.vmin.change, () => this.render_colorbar())
    this.connect(this.model.properties.vmax.change, () => this.render_colorbar())
    this.connect(this.model.properties.background_color.change, () => {
      if (this.container_el) {
        this.container_el.style.background = this.model.background_color
      }
      this.render_sphere()
      this.render_colorbar()
    })
    this.connect(this.model.properties.colorbar_text_color.change, () => this.render_colorbar())
    this.connect(this.model.properties.show_colorbar.change, () => {
      if (this.colorbar_canvas) {
        this.colorbar_canvas.style.display = this.model.show_colorbar ? 'block' : 'none'
      }
    })
    this.connect(this.model.properties.autorotate.change, () => {
      if (this.model.autorotate) {
        this.start_autorotation()
      } else {
        this.stop_autorotation()
      }
    })
    this.connect(this.model.properties.scatter_data.change, () => this.render_sphere())
    this.connect(this.model.properties.line_data.change, () => this.render_sphere())
    this.connect(this.model.properties.bar_data.change, () => this.render_sphere())
    this.connect(this.model.properties.trajectory_data.change, () => this.render_sphere())
    this.connect(this.model.properties.enable_lighting.change, () => this.render_sphere())
    this.connect(this.model.properties.light_azimuth.change, () => this.render_sphere())
    this.connect(this.model.properties.light_elevation.change, () => this.render_sphere())
    this.connect(this.model.properties.light_intensity.change, () => this.render_sphere())
    this.connect(this.model.properties.ambient_light.change, () => this.render_sphere())
  }

  override render(): void {
    super.render()
    
    const width = this.model.width ?? 800
    const height = this.model.height ?? 800
    
    this.container_el = div({style: {
      width: `${width + 140}px`,
      height: `${height}px`,
      background: this.model.background_color,
      position: 'relative',
      display: 'flex',
      cursor: 'grab'
    }})
    
    // Main canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.container_el.appendChild(this.canvas)
    
    // Colorbar canvas
    if (this.model.show_colorbar) {
      this.colorbar_canvas = document.createElement('canvas')
      this.colorbar_canvas.width = 150
      this.colorbar_canvas.height = height
      this.colorbar_canvas.style.marginLeft = '10px'
      this.container_el.appendChild(this.colorbar_canvas)
      this.colorbar_ctx = this.colorbar_canvas.getContext('2d')!
    }
    
    // Tooltip
    this.tooltip_el = div({style: {
      position: 'absolute',
      background: 'rgba(0, 0, 0, 0.85)',
      color: 'white',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '1000',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      whiteSpace: 'nowrap'
    }})
    this.container_el.appendChild(this.tooltip_el)
    
    this.setup_interactions()
    this.shadow_el.appendChild(this.container_el)
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.render_sphere()
    this.render_colorbar()
    
    if (this.model.autorotate) {
      this.start_autorotation()
    }
  }

  private render_colorbar(): void {
    if (!this.colorbar_ctx || !this.colorbar_canvas || !this.model.show_colorbar) return
    
    const ctx = this.colorbar_ctx
    const canvas = this.colorbar_canvas
    const width = canvas.width
    const height = canvas.height
    
    // Clear with background color
    ctx.fillStyle = this.model.background_color
    ctx.fillRect(0, 0, width, height)
    
    const palette = getPalette(this.model.palette)
    const {vmin, vmax} = getValueRange(this.model.values, this.model.vmin, this.model.vmax)
    
    // Colorbar dimensions
    const bar_width = 30
    const bar_height = height * 0.7
    const bar_x = 35
    const bar_y = (height - bar_height) / 2
    
    // Draw color gradient
    const step = bar_height / palette.length
    for (let i = 0; i < palette.length; i++) {
      ctx.fillStyle = palette[palette.length - 1 - i]
      ctx.fillRect(bar_x, bar_y + i * step, bar_width, step + 1)
    }
    
    // Draw border with text color
    ctx.strokeStyle = this.model.colorbar_text_color
    ctx.lineWidth = 1
    ctx.strokeRect(bar_x, bar_y, bar_width, bar_height)
    
    // Draw ticks and labels with text color
    ctx.fillStyle = this.model.colorbar_text_color
    ctx.font = '12px monospace'
    ctx.textAlign = 'left'
    
    const n_ticks = 5
    for (let i = 0; i < n_ticks; i++) {
      const frac = i / (n_ticks - 1)
      const value = vmin + (vmax - vmin) * (1 - frac)
      const y = bar_y + frac * bar_height
      
      // Tick mark
      ctx.beginPath()
      ctx.moveTo(bar_x + bar_width, y)
      ctx.lineTo(bar_x + bar_width + 5, y)
      ctx.stroke()
      
      // Label
      const label = value.toFixed(1)
      ctx.fillText(label, bar_x + bar_width + 10, y + 4)
    }
    
    // Title with text color
    if (this.model.colorbar_title) {
      ctx.save()
      ctx.translate(12, height / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.font = 'bold 13px monospace'
      ctx.fillStyle = this.model.colorbar_text_color
      ctx.fillText(this.model.colorbar_title, 0, 0)
      ctx.restore()
    }
  }

  private setup_interactions(): void {
    if (!this.canvas) return
    
    this.canvas.onmousedown = (e) => {
      this.is_dragging = true
      this.drag_start_x = e.clientX
      this.drag_start_y = e.clientY
      this.drag_start_rotation = this.model.rotation
      this.drag_start_tilt = this.model.tilt
      this.container_el!.style.cursor = 'grabbing'
      
      this.stop_autorotation()
      if (this.rotation_resume_timeout) {
        clearTimeout(this.rotation_resume_timeout)
      }
    }
    
    this.canvas.onmousemove = (e) => {
      const rect = this.canvas!.getBoundingClientRect()
      this.mouse_x = e.clientX - rect.left
      this.mouse_y = e.clientY - rect.top
      
      if (this.is_dragging) {
        const dx = e.clientX - this.drag_start_x
        const dy = e.clientY - this.drag_start_y
        
        const new_rotation = this.drag_start_rotation + dx * 0.5
        this.model.rotation = ((new_rotation % 360) + 360) % 360
        
        const new_tilt = this.drag_start_tilt - dy * 0.5
        this.model.tilt = Math.max(-90, Math.min(90, new_tilt))
      } else if (this.model.enable_hover) {
        this.update_tooltip()
      }
    }
    
    this.canvas.onmouseup = () => {
      this.is_dragging = false
      this.container_el!.style.cursor = 'grab'
      
      if (this.model.autorotate) {
        if (this.rotation_resume_timeout) {
          clearTimeout(this.rotation_resume_timeout)
        }
        this.rotation_resume_timeout = window.setTimeout(() => {
          this.start_autorotation()
        }, 1000)
      }
    }
    
    this.canvas.onmouseleave = () => {
      this.is_dragging = false
      this.container_el!.style.cursor = 'grab'
      if (this.tooltip_el) {
        this.tooltip_el.style.display = 'none'
      }
    }
    
    this.canvas.onwheel = (e) => {
      e.preventDefault()
      const delta = -Math.sign(e.deltaY) * 0.1
      const new_zoom = this.model.zoom + delta
      this.model.zoom = Math.max(0.5, Math.min(8.0, new_zoom))
    }
  }

  private render_sphere(): void {
    if (!this.ctx) return
    
    const ctx = this.ctx
    const width = this.model.width ?? 800
    const height = this.model.height ?? 800
    
    ctx.fillStyle = this.model.background_color
    ctx.fillRect(0, 0, width, height)
    
    const angle_rad = -this.model.rotation * Math.PI / 180
    const tilt_rad = this.model.tilt * Math.PI / 180
    const zoom = this.model.zoom
    const scale = (Math.min(width, height) / 2) * 0.85 * zoom
    const cx = width / 2
    const cy = height / 2
    
    const cos_angle = Math.cos(angle_rad)
    const sin_angle = Math.sin(angle_rad)
    const cos_tilt = Math.cos(tilt_rad)
    const sin_tilt = Math.sin(tilt_rad)
    
    // Project all points
    const projected = this.model.lons.map((lon, i) => {
      const p = projectSphere(lon, this.model.lats[i], cos_angle, sin_angle, cos_tilt, sin_tilt)
      return {
        x: cx + p.x * scale,
        y: cy - p.y * scale,
        depth: p.depth,
        visible: p.visible
      }
    })
    
    // Create quads
    const quads: Quad[] = []
    const palette = getPalette(this.model.palette)
    const {vmin, vmax} = getValueRange(this.model.values, this.model.vmin, this.model.vmax)
    
    const n_lat = this.model.n_lat
    const n_lon = this.model.n_lon
    
    // Calculate light direction in world space if lighting is enabled
    let light_x = 0, light_y = 0, light_z = 0
    if (this.model.enable_lighting) {
      const light_az_rad = this.model.light_azimuth * Math.PI / 180
      const light_el_rad = this.model.light_elevation * Math.PI / 180
      
      light_x = Math.cos(light_el_rad) * Math.sin(light_az_rad)
      light_y = Math.cos(light_el_rad) * Math.cos(light_az_rad)
      light_z = Math.sin(light_el_rad)
    }
    
    for (let i = 0; i < n_lat - 1; i++) {
      for (let j = 0; j < n_lon - 1; j++) {
        const idx0 = i * n_lon + j
        const idx1 = i * n_lon + (j + 1)
        const idx2 = (i + 1) * n_lon + (j + 1)
        const idx3 = (i + 1) * n_lon + j
        
        const p0 = projected[idx0]
        const p1 = projected[idx1]
        const p2 = projected[idx2]
        const p3 = projected[idx3]
        
        if (p0.visible || p1.visible || p2.visible || p3.visible) {
          const avg_value = (this.model.values[idx0] + this.model.values[idx1] + 
                           this.model.values[idx2] + this.model.values[idx3]) / 4
          const avg_depth = (p0.depth + p1.depth + p2.depth + p3.depth) / 4
          
          let color = valueToColor(avg_value, palette, vmin, vmax, this.model.nan_color)
          
          // Apply lighting if enabled
          if (this.model.enable_lighting) {
            const avg_lon = (this.model.lons[idx0] + this.model.lons[idx1] + 
                           this.model.lons[idx2] + this.model.lons[idx3]) / 4
            const avg_lat = (this.model.lats[idx0] + this.model.lats[idx1] + 
                           this.model.lats[idx2] + this.model.lats[idx3]) / 4
            
            const lighting_factor = this.calculate_lighting(
              avg_lon, avg_lat, light_x, light_y, light_z
            )
            
            color = this.apply_lighting(color, lighting_factor)
          }
          
          quads.push({
            depth: avg_depth,
            points: [p0, p1, p2, p3],
            color: color
          })
        }
      }
    }
    
    quads.sort((a, b) => a.depth - b.depth)
    
    // Render quads
    for (const quad of quads) {
      ctx.fillStyle = quad.color
      ctx.strokeStyle = quad.color
      ctx.lineWidth = 1.1
      
      ctx.beginPath()
      ctx.moveTo(quad.points[0].x, quad.points[0].y)
      ctx.lineTo(quad.points[1].x, quad.points[1].y)
      ctx.lineTo(quad.points[2].x, quad.points[2].y)
      ctx.lineTo(quad.points[3].x, quad.points[3].y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    
    if (this.model.show_coastlines && this.model.coast_lons.length > 0) {
      this.draw_coastlines(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
    }
    
    if (this.model.show_countries && this.model.country_lons.length > 0) {
      this.draw_countries(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
    }
    
    this.draw_lines(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
    this.draw_trajectories(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
    this.draw_bars(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
    this.draw_scatter(cos_angle, sin_angle, cos_tilt, sin_tilt, scale, cx, cy)
  }

  private draw_coastlines(cos_angle: number, sin_angle: number, cos_tilt: number, 
                         sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx) return
    
    const ctx = this.ctx
    const coast_lons = this.model.coast_lons
    const coast_lats = this.model.coast_lats
    
    ctx.strokeStyle = this.model.coastline_color
    ctx.lineWidth = this.model.coastline_width
    ctx.beginPath()
    
    let drawing = false
    for (let i = 0; i < coast_lons.length; i++) {
      if (coast_lons[i] === null) {
        drawing = false
        continue
      }
      
      const p = projectSphere(coast_lons[i], coast_lats[i], cos_angle, sin_angle, cos_tilt, sin_tilt)
      
      if (p.visible) {
        const px = cx + p.x * scale
        const py = cy - p.y * scale
        
        if (!drawing) {
          ctx.moveTo(px, py)
          drawing = true
        } else {
          ctx.lineTo(px, py)
        }
      } else {
        drawing = false
      }
    }
    
    ctx.stroke()
  }

  private draw_countries(cos_angle: number, sin_angle: number, cos_tilt: number, 
                        sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx) return
    
    const ctx = this.ctx
    const country_lons = this.model.country_lons
    const country_lats = this.model.country_lats
    
    ctx.strokeStyle = this.model.country_color
    ctx.lineWidth = this.model.country_width
    ctx.beginPath()
    
    let drawing = false
    for (let i = 0; i < country_lons.length; i++) {
      if (country_lons[i] === null) {
        drawing = false
        continue
      }
      
      const p = projectSphere(country_lons[i], country_lats[i], cos_angle, sin_angle, cos_tilt, sin_tilt)
      
      if (p.visible) {
        const px = cx + p.x * scale
        const py = cy - p.y * scale
        
        if (!drawing) {
          ctx.moveTo(px, py)
          drawing = true
        } else {
          ctx.lineTo(px, py)
        }
      } else {
        drawing = false
      }
    }
    
    ctx.stroke()
  }

  private draw_scatter(cos_angle: number, sin_angle: number, cos_tilt: number, 
                      sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx || !this.model.scatter_data.length) return
    
    const ctx = this.ctx
    const sorted_points = this.model.scatter_data
      .map((point: ScatterPoint) => {
        const p = projectSphere(point.lon, point.lat, cos_angle, sin_angle, cos_tilt, sin_tilt)
        return {...point, ...p}
      })
      .filter((p: any) => p.visible)
      .sort((a: any, b: any) => a.depth - b.depth)
    
    for (const point of sorted_points) {
      const px = cx + point.x * scale
      const py = cy - point.y * scale
      
      ctx.beginPath()
      ctx.arc(px, py, point.size || 5, 0, 2 * Math.PI)
      ctx.fillStyle = point.color || this.model.scatter_color
      ctx.fill()
      ctx.strokeStyle = point.border_color || '#000000'
      ctx.lineWidth = point.border_width || 1
      ctx.stroke()
    }
  }

  private draw_trajectories(cos_angle: number, sin_angle: number, cos_tilt: number, 
    sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx || !this.model.trajectory_data.length) return

    const ctx = this.ctx

    for (const traj of this.model.trajectory_data as Trajectory[]) {
      const color = traj.color || this.model.trajectory_color
      const width = traj.width || 2.5
      const show_points = traj.show_points !== undefined ? traj.show_points : false
      const point_size = traj.point_size || 4
      const point_color = traj.point_color || color

      // Process trajectory points into segments
      const all_segments: Array<Array<{x: number, y: number, depth: number}>> = []

      for (let seg_idx = 0; seg_idx < traj.coords.length - 1; seg_idx++) {
        const from_coord = traj.coords[seg_idx]
        const to_coord = traj.coords[seg_idx + 1]

        const arc_points = 10
        const segment_points: Array<{x: number, y: number, depth: number}> = []

        for (let i = 0; i <= arc_points; i++) {
          const t = i / arc_points

          const lat = from_coord.lat + t * (to_coord.lat - from_coord.lat)
          const lon = from_coord.lon + t * (to_coord.lon - from_coord.lon)
          const total_altitude = from_coord.altitude + t * (to_coord.altitude - from_coord.altitude)

          const lat_rad = lat * Math.PI / 180
          const lon_rad = -lon * Math.PI / 180
          const altitude_factor = 1 + total_altitude * 0.0008

          const x = altitude_factor * Math.cos(lat_rad) * Math.cos(lon_rad)
          const y = altitude_factor * Math.cos(lat_rad) * Math.sin(lon_rad)
          const z = altitude_factor * Math.sin(lat_rad)

          const x_rot = x * cos_angle - y * sin_angle
          const y_rot = x * sin_angle + y * cos_angle

          const y_tilt = y_rot * cos_tilt - z * sin_tilt
          const z_tilt = y_rot * sin_tilt + z * cos_tilt

          segment_points.push({
            x: cx + x_rot * scale,
            y: cy - z_tilt * scale,
            depth: y_tilt
          })
        }

        all_segments.push(segment_points)
      }

      // --- Draw lines with depth-based alpha ---
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      for (const segment of all_segments) {
        for (let i = 0; i < segment.length - 1; i++) {
          const p0 = segment[i]
          const p1 = segment[i + 1]
          const avg_depth = (p0.depth + p1.depth) / 2

          let alpha: number
          if (avg_depth > 0.1) {
            alpha = 1.0
          } else if (avg_depth < -0.3) {
            alpha = 0.08
          } else {
            // smooth ramp: t goes 0 (at depth -0.3) to 1 (at depth 0.1)
            const t = (avg_depth - (-0.3)) / (0.1 - (-0.3))
            alpha = 0.08 + (1.0 - 0.08) * (t * t)
          }

          ctx.globalAlpha = alpha
          ctx.strokeStyle = color
          ctx.lineWidth = width
          ctx.beginPath()
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(p1.x, p1.y)
          ctx.stroke()
        }
      }

      // --- Draw points with depth-based alpha ---
      if (show_points) {
        for (const coord of traj.coords) {
          const lat_rad = coord.lat * Math.PI / 180
          const lon_rad = -coord.lon * Math.PI / 180
          const altitude_factor = 1.0 + coord.altitude * 0.0008

          const x = altitude_factor * Math.cos(lat_rad) * Math.cos(lon_rad)
          const y = altitude_factor * Math.cos(lat_rad) * Math.sin(lon_rad)
          const z = altitude_factor * Math.sin(lat_rad)

          const x_rot = x * cos_angle - y * sin_angle
          const y_rot = x * sin_angle + y * cos_angle
          const y_tilt = y_rot * cos_tilt - z * sin_tilt
          const z_tilt = y_rot * sin_tilt + z * cos_tilt

          let pt_alpha: number
          if (y_tilt > 0.1) {
            pt_alpha = 1.0
          } else if (y_tilt < -0.3) {
            pt_alpha = 0.08
          } else {
            const t = (y_tilt - (-0.3)) / (0.1 - (-0.3))
            pt_alpha = 0.08 + (1.0 - 0.08) * (t * t)
          }

          const screen_x = cx + x_rot * scale
          const screen_y = cy - z_tilt * scale

          ctx.globalAlpha = pt_alpha
          ctx.beginPath()
          ctx.arc(screen_x, screen_y, point_size, 0, 2 * Math.PI)
          ctx.fillStyle = point_color
          ctx.fill()
          ctx.strokeStyle = '#000000'
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }

      // Reset alpha after each trajectory
      ctx.globalAlpha = 1.0
    }
  }


  private draw_lines(cos_angle: number, sin_angle: number, cos_tilt: number, 
                    sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx || !this.model.line_data.length) return
    
    const ctx = this.ctx
    
    for (const line of this.model.line_data as Line[]) {
      ctx.strokeStyle = line.color || this.model.line_color
      ctx.lineWidth = line.width || 2
      ctx.beginPath()
      
      let first = true
      
      // Interpolate between consecutive points
      for (let i = 0; i < line.coords.length; i++) {
        const coord = line.coords[i]
        
        // If this is not the first point, interpolate from previous to current
        if (i > 0) {
          const prev_coord = line.coords[i - 1]
          const interpolated = this.interpolate_great_circle(
            prev_coord[0], prev_coord[1], 
            coord[0], coord[1], 
            20  // number of segments
          )
          
          for (const interp_coord of interpolated) {
            const p = projectSphere(interp_coord[0], interp_coord[1], cos_angle, sin_angle, cos_tilt, sin_tilt)
            
            if (p.visible) {
              const px = cx + p.x * scale
              const py = cy - p.y * scale
              
              if (first) {
                ctx.moveTo(px, py)
                first = false
              } else {
                ctx.lineTo(px, py)
              }
            } else {
              first = true
            }
          }
        } else {
          // First point - just draw it
          const p = projectSphere(coord[0], coord[1], cos_angle, sin_angle, cos_tilt, sin_tilt)
          
          if (p.visible) {
            const px = cx + p.x * scale
            const py = cy - p.y * scale
            ctx.moveTo(px, py)
            first = false
          }
        }
      }
      
      ctx.stroke()
    }
  }

  private calculate_lighting(lon: number, lat: number, light_x: number, light_y: number, light_z: number): number {
    // Convert lon/lat to surface normal in world space
    const lon_rad = lon * Math.PI / 180
    const lat_rad = lat * Math.PI / 180
    
    const normal_x = Math.cos(lat_rad) * Math.cos(lon_rad)
    const normal_y = Math.cos(lat_rad) * Math.sin(lon_rad)
    const normal_z = Math.sin(lat_rad)
    
    // Calculate dot product (Lambert's cosine law)
    const dot = normal_x * light_x + normal_y * light_y + normal_z * light_z
    
    // Clamp between 0 and 1, then apply intensity and ambient
    const diffuse = Math.max(0, dot) * this.model.light_intensity
    const lighting = this.model.ambient_light + diffuse
    
    return Math.min(1, lighting)
  }

  private apply_lighting(color: string, lighting_factor: number): string {
    // Parse hex color
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    
    // Apply lighting
    const new_r = Math.floor(r * lighting_factor)
    const new_g = Math.floor(g * lighting_factor)
    const new_b = Math.floor(b * lighting_factor)
    
    return `#${new_r.toString(16).padStart(2, '0')}${new_g.toString(16).padStart(2, '0')}${new_b.toString(16).padStart(2, '0')}`
  }

  private interpolate_great_circle(lon1: number, lat1: number, lon2: number, lat2: number, segments: number): Array<[number, number]> {
    // Convert to radians
    const lat1_rad = lat1 * Math.PI / 180
    const lon1_rad = lon1 * Math.PI / 180
    const lat2_rad = lat2 * Math.PI / 180
    const lon2_rad = lon2 * Math.PI / 180
    
    // Convert to Cartesian coordinates
    const x1 = Math.cos(lat1_rad) * Math.cos(lon1_rad)
    const y1 = Math.cos(lat1_rad) * Math.sin(lon1_rad)
    const z1 = Math.sin(lat1_rad)
    
    const x2 = Math.cos(lat2_rad) * Math.cos(lon2_rad)
    const y2 = Math.cos(lat2_rad) * Math.sin(lon2_rad)
    const z2 = Math.sin(lat2_rad)
    
    // Calculate the angle between the two points
    const dot = x1 * x2 + y1 * y2 + z1 * z2
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
    
    const result: Array<[number, number]> = []
    
    // Interpolate along the great circle
    for (let i = 0; i <= segments; i++) {
      const f = i / segments
      
      if (angle < 0.001) {
        // Points are very close, use linear interpolation
        result.push([
          lon1 + (lon2 - lon1) * f,
          lat1 + (lat2 - lat1) * f
        ])
      } else {
        // Use spherical linear interpolation (slerp)
        const sin_angle = Math.sin(angle)
        const a = Math.sin((1 - f) * angle) / sin_angle
        const b = Math.sin(f * angle) / sin_angle
        
        const x = a * x1 + b * x2
        const y = a * y1 + b * y2
        const z = a * z1 + b * z2
        
        // Convert back to lat/lon
        const lat = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI
        const lon = Math.atan2(y, x) * 180 / Math.PI
        
        result.push([lon, lat])
      }
    }
    
    return result
  }

  private draw_bars(cos_angle: number, sin_angle: number, cos_tilt: number, 
                   sin_tilt: number, scale: number, cx: number, cy: number): void {
    if (!this.ctx || !this.model.bar_data.length) return
    
    const ctx = this.ctx
    
    // Process each bar
    const processed_bars = []
    
    for (const bar of this.model.bar_data as Bar[]) {
      const lat_rad = bar.lat * Math.PI / 180
      const lon_rad = -bar.lon * Math.PI / 180  // Note: negative lon
      
      // Base of bar (on sphere surface, radius = 1)
      const x_base = Math.cos(lat_rad) * Math.cos(lon_rad)
      const y_base = Math.cos(lat_rad) * Math.sin(lon_rad)
      const z_base = Math.sin(lat_rad)
      
      // Top of bar (extended outward)
      const bar_height_factor = bar.height || 100
      const bar_radius = 1 + bar_height_factor * 0.0008  // Scale factor
      const x_top = bar_radius * Math.cos(lat_rad) * Math.cos(lon_rad)
      const y_top = bar_radius * Math.cos(lat_rad) * Math.sin(lon_rad)
      const z_top = bar_radius * Math.sin(lat_rad)
      
      // Bar width and depth - REDUCED for smaller bars
      const bar_width = (bar.width || 2) * 0.025  // Reduced from 0.025
      const bar_depth = bar_width * 0.6  // Reduced from 0.6 for slimmer profile
      
      // Calculate perpendicular vectors for bar width (tangent)
      const dx_width = -Math.sin(lon_rad) * bar_width / 2
      const dy_width = Math.cos(lon_rad) * bar_width / 2
      
      // Calculate perpendicular vectors for bar depth (radial tangent)
      // This is perpendicular to both the radial direction and the width direction
      const dx_depth = -Math.cos(lat_rad) * Math.cos(lon_rad) * bar_depth / 2
      const dy_depth = -Math.cos(lat_rad) * Math.sin(lon_rad) * bar_depth / 2
      const dz_depth = Math.cos(lat_rad) * bar_depth / 2
      
      // Eight corners of the 3D bar (rectangular prism)
      const corners = [
        // Base corners (4 points)
        {x: x_base - dx_width - dx_depth, y: y_base - dy_width - dy_depth, z: z_base - dz_depth},  // 0: base back-left
        {x: x_base + dx_width - dx_depth, y: y_base + dy_width - dy_depth, z: z_base - dz_depth},  // 1: base back-right
        {x: x_base + dx_width + dx_depth, y: y_base + dy_width + dy_depth, z: z_base + dz_depth},  // 2: base front-right
        {x: x_base - dx_width + dx_depth, y: y_base - dy_width + dy_depth, z: z_base + dz_depth},  // 3: base front-left
        // Top corners (4 points)
        {x: x_top - dx_width - dx_depth, y: y_top - dy_width - dy_depth, z: z_top - dz_depth},     // 4: top back-left
        {x: x_top + dx_width - dx_depth, y: y_top + dy_width - dy_depth, z: z_top - dz_depth},     // 5: top back-right
        {x: x_top + dx_width + dx_depth, y: y_top + dy_width + dy_depth, z: z_top + dz_depth},     // 6: top front-right
        {x: x_top - dx_width + dx_depth, y: y_top - dy_width + dy_depth, z: z_top + dz_depth}      // 7: top front-left
      ]
      
      // Apply rotations to all corners
      const rotated_corners = corners.map(corner => {
        // Rotation around Z-axis (longitude rotation)
        let x_rot = corner.x * cos_angle - corner.y * sin_angle
        let y_rot = corner.x * sin_angle + corner.y * cos_angle
        let z_rot = corner.z
        
        // Tilt around X-axis (latitude tilt)
        const y_tilt = y_rot * cos_tilt - z_rot * sin_tilt
        const z_tilt = y_rot * sin_tilt + z_rot * cos_tilt
        
        return {
          x: x_rot,
          y: y_tilt,
          z: z_tilt,
          screen_x: cx + x_rot * scale,
          screen_y: cy - z_tilt * scale
        }
      })
      
      // Check if bar is visible
      const is_visible = rotated_corners.some(c => c.y > -0.1)
      
      if (is_visible) {
        // Calculate average depth for sorting
        const avg_depth = rotated_corners.reduce((sum, c) => sum + c.y, 0) / rotated_corners.length
        
        processed_bars.push({
          corners: rotated_corners,
          color: bar.color || this.model.bar_color,
          border_color: bar.border_color || '#000000',
          border_width: bar.border_width || 1,
          depth: avg_depth,
          label: bar.label
        })
      }
    }
    
    // Sort by depth (back to front)
    processed_bars.sort((a, b) => a.depth - b.depth)
    
    // Draw bars with multiple faces
    for (const bar of processed_bars) {
      const c = bar.corners
      const base_color = bar.color
      
      // Define faces with their corner indices and shading
      const faces = [
        // Back face (indices 0,1,5,4) - darkest
        {indices: [0, 1, 5, 4], shade: 0.5},
        // Left face (indices 0,4,7,3) - dark
        {indices: [0, 4, 7, 3], shade: 0.65},
        // Right face (indices 1,2,6,5) - medium
        {indices: [1, 2, 6, 5], shade: 0.75},
        // Front face (indices 3,7,6,2) - brightest
        {indices: [3, 7, 6, 2], shade: 0.9},
        // Top face (indices 4,5,6,7) - top
        {indices: [4, 5, 6, 7], shade: 1.0}
      ]
      
      // Draw each face
      for (const face of faces) {
        const face_corners = face.indices.map(i => c[i])
        
        // Only draw if face is facing forward (simple check)
        const avg_y = face_corners.reduce((sum, p) => sum + p.y, 0) / face_corners.length
        if (avg_y < -0.15) continue  // Skip faces pointing away
        
        // Apply shading
        const shaded_color = this.darkenColor(base_color, face.shade)
        
        ctx.fillStyle = shaded_color
        ctx.strokeStyle = bar.border_color
        ctx.lineWidth = bar.border_width
        
        ctx.beginPath()
        ctx.moveTo(face_corners[0].screen_x, face_corners[0].screen_y)
        for (let i = 1; i < face_corners.length; i++) {
          ctx.lineTo(face_corners[i].screen_x, face_corners[i].screen_y)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  private darkenColor(color: string, factor: number): string {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    
    return `#${Math.floor(r * factor).toString(16).padStart(2, '0')}${Math.floor(g * factor).toString(16).padStart(2, '0')}${Math.floor(b * factor).toString(16).padStart(2, '0')}`
  }

  // private lightenColor(color: string, factor: number): string {
  //   const r = parseInt(color.slice(1, 3), 16)
  //   const g = parseInt(color.slice(3, 5), 16)
  //   const b = parseInt(color.slice(5, 7), 16)
    
  //   return `#${Math.min(255, Math.floor(r * factor)).toString(16).padStart(2, '0')}${Math.min(255, Math.floor(g * factor)).toString(16).padStart(2, '0')}${Math.min(255, Math.floor(b * factor)).toString(16).padStart(2, '0')}`
  // }

  private update_tooltip(): void {
    if (!this.tooltip_el || !this.canvas || !this.ctx) return
    
    // Check bar data first
    for (const bar of this.model.bar_data as Bar[]) {
      const screen_pos = this.get_screen_coords(bar.lon, bar.lat)
      if (screen_pos) {
        const bar_width = bar.width || 2
        const dist_x = Math.abs(this.mouse_x - screen_pos.x)
        const dist_y = this.mouse_y - screen_pos.y
        
        if (dist_x < bar_width && dist_y > -bar.height * 0.2 && dist_y < 5) {
          this.tooltip_el.innerHTML = bar.label || `Bar: ${bar.height.toFixed(2)}`
          this.tooltip_el.style.display = 'block'
          this.tooltip_el.style.left = `${this.mouse_x + 15}px`
          this.tooltip_el.style.top = `${this.mouse_y - 30}px`
          return
        }
      }
    }
    
    // Check scatter points
    for (const point of this.model.scatter_data as ScatterPoint[]) {
      const screen_pos = this.get_screen_coords(point.lon, point.lat)
      if (screen_pos) {
        const dist = Math.sqrt((this.mouse_x - screen_pos.x) ** 2 + 
                              (this.mouse_y - screen_pos.y) ** 2)
        if (dist < (point.size || 5) + 3) {
          this.tooltip_el.innerHTML = point.label || `(${point.lon.toFixed(2)}, ${point.lat.toFixed(2)})`
          this.tooltip_el.style.display = 'block'
          this.tooltip_el.style.left = `${this.mouse_x + 15}px`
          this.tooltip_el.style.top = `${this.mouse_y - 30}px`
          return
        }
      }
    }
    
    // Check grid values
    const imageData = this.ctx.getImageData(this.mouse_x, this.mouse_y, 1, 1)
    const pixel = imageData.data
    
    if (pixel[0] > 10 || pixel[1] > 10 || pixel[2] > 10) {
      const palette = getPalette(this.model.palette)
      const {vmin, vmax} = getValueRange(this.model.values, this.model.vmin, this.model.vmax)
      
      let closest_idx = 0
      let min_distance = Infinity
      
      for (let i = 0; i < palette.length; i++) {
        const pal_r = parseInt(palette[i].slice(1, 3), 16)
        const pal_g = parseInt(palette[i].slice(3, 5), 16)
        const pal_b = parseInt(palette[i].slice(5, 7), 16)
        
        const distance = Math.abs(pal_r - pixel[0]) + Math.abs(pal_g - pixel[1]) + 
                        Math.abs(pal_b - pixel[2])
        
        if (distance < min_distance) {
          min_distance = distance
          closest_idx = i
        }
      }
      
      const value = vmin + (closest_idx / (palette.length - 1)) * (vmax - vmin)
      
      this.tooltip_el.innerHTML = `Value: ${value.toFixed(2)}`
      this.tooltip_el.style.display = 'block'
      this.tooltip_el.style.left = `${this.mouse_x + 15}px`
      this.tooltip_el.style.top = `${this.mouse_y - 30}px`
    } else {
      this.tooltip_el.style.display = 'none'
    }
  }

  private get_screen_coords(lon: number, lat: number): {x: number, y: number} | null {
    const width = this.model.width ?? 800
    const height = this.model.height ?? 800
    const angle_rad = -this.model.rotation * Math.PI / 180
    const tilt_rad = this.model.tilt * Math.PI / 180
    const zoom = this.model.zoom
    const scale = (Math.min(width, height) / 2) * 0.85 * zoom
    const cx = width / 2
    const cy = height / 2
    
    const cos_angle = Math.cos(angle_rad)
    const sin_angle = Math.sin(angle_rad)
    const cos_tilt = Math.cos(tilt_rad)
    const sin_tilt = Math.sin(tilt_rad)
    
    const p = projectSphere(lon, lat, cos_angle, sin_angle, cos_tilt, sin_tilt)
    
    if (p.visible) {
      return {
        x: cx + p.x * scale,
        y: cy - p.y * scale
      }
    }
    
    return null
  }

  private start_autorotation(): void {
    if (this.animation_id !== undefined) return
    
    const animate = () => {
      if (!this.model.autorotate || this.is_dragging) return
      
      this.model.rotation = (this.model.rotation + this.model.rotation_speed * 0.5) % 360
      this.animation_id = requestAnimationFrame(animate)
    }
    
    animate()
  }

  private stop_autorotation(): void {
    if (this.animation_id !== undefined) {
      cancelAnimationFrame(this.animation_id)
      this.animation_id = undefined
    }
  }

  override remove(): void {
    this.stop_autorotation()
    if (this.rotation_resume_timeout) {
      clearTimeout(this.rotation_resume_timeout)
    }
    super.remove()
  }
}

export namespace GriddedSphere {
  export type Attrs = p.AttrsOf<Props>

  export type Props = LayoutDOM.Props & {
    lons: p.Property<number[]>
    lats: p.Property<number[]>
    values: p.Property<number[]>
    n_lat: p.Property<number>
    n_lon: p.Property<number>
    palette: p.Property<string>
    vmin: p.Property<number>
    vmax: p.Property<number>
    nan_color: p.Property<string>
    rotation: p.Property<number>
    tilt: p.Property<number>
    zoom: p.Property<number>
    autorotate: p.Property<boolean>
    rotation_speed: p.Property<number>
    show_coastlines: p.Property<boolean>
    coastline_color: p.Property<string>
    coastline_width: p.Property<number>
    coast_lons: p.Property<any[]>
    coast_lats: p.Property<any[]>
    show_countries: p.Property<boolean>
    country_color: p.Property<string>
    country_width: p.Property<number>
    country_lons: p.Property<any[]>
    country_lats: p.Property<any[]>
    enable_hover: p.Property<boolean>
    scatter_data: p.Property<any[]>
    scatter_color: p.Property<string>
    line_data: p.Property<any[]>
    line_color: p.Property<string>
    bar_data: p.Property<any[]>
    bar_color: p.Property<string>
    trajectory_data: p.Property<any[]>
    trajectory_color: p.Property<string>
    show_colorbar: p.Property<boolean>
    colorbar_title: p.Property<string>
    background_color: p.Property<string>
    colorbar_text_color: p.Property<string>
    enable_lighting: p.Property<boolean>
    light_azimuth: p.Property<number>
    light_elevation: p.Property<number>
    light_intensity: p.Property<number>
    ambient_light: p.Property<number>
  }
}

export interface GriddedSphere extends GriddedSphere.Attrs {}

export class GriddedSphere extends LayoutDOM {
  declare properties: GriddedSphere.Props
  declare __view_type__: GriddedSphereView

  constructor(attrs?: Partial<GriddedSphere.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = GriddedSphereView

    this.define<GriddedSphere.Props>(({Any, Bool, Float, Int, List, String}) => ({
      lons: [ List(Float), [] ],
      lats: [ List(Float), [] ],
      values: [ List(Float), [] ],
      n_lat: [ Int, 30 ],
      n_lon: [ Int, 60 ],
      palette: [ String, 'Turbo256' ],
      vmin: [ Float, NaN ],
      vmax: [ Float, NaN ],
      nan_color: [ String, '#808080' ],
      rotation: [ Float, 0 ],
      tilt: [ Float, 0 ],
      zoom: [ Float, 1.0 ],
      autorotate: [ Bool, false ],
      rotation_speed: [ Float, 1.0 ],
      show_coastlines: [ Bool, true ],
      coastline_color: [ String, '#000000' ],
      coastline_width: [ Float, 0.4 ],
      coast_lons: [ List(Any), [] ],
      coast_lats: [ List(Any), [] ],
      show_countries: [ Bool, false ],
      country_color: [ String, '#333333' ],
      country_width: [ Float, 0.4 ],
      country_lons: [ List(Any), [] ],
      country_lats: [ List(Any), [] ],
      enable_hover: [ Bool, true ],
      scatter_data: [ List(Any), [] ],
      scatter_color: [ String, '#ff0000' ],
      line_data: [ List(Any), [] ],
      line_color: [ String, '#0000ff' ],
      bar_data: [ List(Any), [] ],
      bar_color: [ String, '#00ff00' ],
      trajectory_data: [ List(Any), [] ],
      trajectory_color: [ String, '#ff00ff' ],
      show_colorbar: [ Bool, true ],
      colorbar_title: [ String, 'Value' ],
      background_color: [ String, '#0a0a0a' ],
      colorbar_text_color: [ String, '#ffffff' ],
      enable_lighting: [ Bool, false ],
      light_azimuth: [ Float, -45 ],
      light_elevation: [ Float, 45 ],
      light_intensity: [ Float, 0.8 ],
      ambient_light: [ Float, 0.3 ],
    }))
  }
}