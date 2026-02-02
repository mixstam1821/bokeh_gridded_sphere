/**
 * Projection utilities for geographic visualizations
 */

export interface Point2D {
  x: number
  y: number
}

export interface Point3D extends Point2D {
  depth: number
  visible: boolean
}

/**
 * Sphere projection with rotation and tilt
 */
export function projectSphere(
  lon: number, 
  lat: number,
  cos_angle: number,
  sin_angle: number,
  cos_tilt: number,
  sin_tilt: number
): Point3D {
  const lat_rad = lat * Math.PI / 180
  const lon_rad = lon * Math.PI / 180
  
  const x = Math.cos(lat_rad) * Math.cos(-lon_rad)
  const y = Math.cos(lat_rad) * Math.sin(-lon_rad)
  const z = Math.sin(lat_rad)
  
  const x_rot = x * cos_angle - y * sin_angle
  const y_rot = x * sin_angle + y * cos_angle
  const y_tilt = y_rot * cos_tilt - z * sin_tilt
  const z_tilt = y_rot * sin_tilt + z * cos_tilt
  
  return {
    x: x_rot,
    y: z_tilt,
    depth: y_tilt,
    visible: y_tilt > -0.15
  }
}

/**
 * Mollweide projection
 */
export function projectMollweide(lon: number, lat: number): Point2D {
  const lambda = lon * Math.PI / 180
  const phi = lat * Math.PI / 180
  
  let theta = phi
  for (let i = 0; i < 10; i++) {
    const dtheta = -(theta + Math.sin(theta) - Math.PI * Math.sin(phi)) / (1 + Math.cos(theta))
    theta += dtheta
    if (Math.abs(dtheta) < 1e-6) break
  }
  
  const x = (2 * Math.sqrt(2) / Math.PI) * lambda * Math.cos(theta / 2)
  const y = Math.sqrt(2) * Math.sin(theta / 2)
  
  return {x, y}
}

/**
 * Natural Earth projection
 */
export function projectNaturalEarth(lon: number, lat: number): Point2D {
  const lplam = lon * Math.PI / 180
  const lpphi = lat * Math.PI / 180
  
  const A0 = 0.8707
  const A1 = -0.131979
  const A2 = -0.013791
  const A3 = 0.003971
  const A4 = -0.001529
  const B0 = 1.007226
  const B1 = 0.015085
  const B2 = -0.044475
  const B3 = 0.028874
  const B4 = -0.005916
  
  const phi2 = lpphi * lpphi
  const phi4 = phi2 * phi2
  
  const x = lplam * (A0 + phi2 * (A1 + phi2 * (A2 + phi4 * phi2 * (A3 + phi2 * A4))))
  const y = lpphi * (B0 + phi2 * (B1 + phi4 * (B2 + B3 * phi2 + B4 * phi4)))
  
  return {x, y}
}

/**
 * Robinson projection
 */
export function projectRobinson(lon: number, lat: number): Point2D {
  // Robinson projection lookup tables
  const ROBINSON_AA = [
    1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427,
    0.9216, 0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732,
    0.6213, 0.5722, 0.5322
  ]
  
  const ROBINSON_BB = [
    0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340,
    0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936,
    0.9394, 0.9761, 1.0000
  ]
  
  const lplam = lon * Math.PI / 180
  let lpphi = lat * Math.PI / 180
  
  const sign = lpphi < 0 ? -1 : 1
  lpphi = Math.abs(lpphi)
  
  const phi_deg = lpphi * 180 / Math.PI
  const i = Math.floor(phi_deg / 5)
  const i_clamped = Math.min(i, 17)
  
  const dphi = (phi_deg - i_clamped * 5) / 5
  
  const aa = ROBINSON_AA[i_clamped] + (ROBINSON_AA[i_clamped + 1] - ROBINSON_AA[i_clamped]) * dphi
  const bb = ROBINSON_BB[i_clamped] + (ROBINSON_BB[i_clamped + 1] - ROBINSON_BB[i_clamped]) * dphi
  
  const x = 0.8487 * aa * lplam
  const y = 1.3523 * bb * sign
  
  return {x, y}
}

/**
 * Plate Carrée (Equirectangular) projection
 */
export function projectPlateCarree(lon: number, lat: number): Point2D {
  const x = lon * Math.PI / 180
  const y = lat * Math.PI / 180
  return {x, y}
}

/**
 * Get projection function by name
 */
export function getProjection(name: string): (lon: number, lat: number) => Point2D {
  switch(name) {
    case 'mollweide':
      return projectMollweide
    case 'natural_earth':
      return projectNaturalEarth
    case 'robinson':
      return projectRobinson
    case 'plate_carree':
      return projectPlateCarree
    default:
      return projectNaturalEarth
  }
}

/**
 * Get scale factor for projection
 */
export function getProjectionScale(name: string, width: number, height: number): number {
  const base = Math.min(width, height)
  
  switch(name) {
    case 'mollweide':
      return base / 4
    case 'robinson':
      return base / 3.8
    case 'natural_earth':
      return base / 3.5
    case 'plate_carree':
      return base / 3.5
    default:
      return base / 3.5
  }
}
