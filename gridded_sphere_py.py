"""
GriddedSphere - Python wrapper for gridded sphere visualization
"""
from bokeh.core.properties import Int, Float, String, List, Bool, Any
from bokeh.models import LayoutDOM
import numpy as np

class GriddedSphere(LayoutDOM):
    """Sphere with gridded data"""
    
    __implementation__ = "gridded_sphere.ts"
    
    lons = List(Float)
    lats = List(Float)
    values = List(Float)
    n_lat = Int(30)
    n_lon = Int(60)
    palette = String("Turbo256")
    vmin = Float(float('nan'))
    vmax = Float(float('nan'))
    nan_color = String("#808080")
    rotation = Float(0)
    tilt = Float(0)
    zoom = Float(1.0)
    autorotate = Bool(False)
    rotation_speed = Float(1.0)
    show_coastlines = Bool(True)
    coastline_color = String("#000000")
    coastline_width = Float(0.4)
    coast_lons = List(Any, default=[])
    coast_lats = List(Any, default=[])
    show_countries = Bool(False)
    country_color = String("#333333")
    country_width = Float(0.4)
    country_lons = List(Any, default=[])
    country_lats = List(Any, default=[])
    enable_hover = Bool(True)
    scatter_data = List(Any, default=[])
    scatter_color = String("#ff0000")
    line_data = List(Any, default=[])
    line_color = String("#0000ff")
    bar_data = List(Any, default=[])
    bar_color = String("#00ff00")
    trajectory_data = List(Any, default=[])
    trajectory_color = String("#ff00ff")
    show_colorbar = Bool(True)
    colorbar_title = String("Value")
    background_color = String("#0a0a0a")
    colorbar_text_color = String("#ffffff")
    enable_lighting = Bool(False)
    light_azimuth = Float(-45.0)
    light_elevation = Float(45.0)
    light_intensity = Float(0.8)
    ambient_light = Float(0.3)
    
    def __init__(self, **kwargs):
        # Auto-load coastlines if show_coastlines=True and coast_lons is empty
        if kwargs.get('show_coastlines', True) and not kwargs.get('coast_lons'):
            coast_lons_data, coast_lats_data = self._load_coastlines_bundled()
            if coast_lons_data:
                kwargs['coast_lons'] = coast_lons_data
                kwargs['coast_lats'] = coast_lats_data
        
        # Auto-load countries if show_countries=True and country_lons is empty
        if kwargs.get('show_countries', False) and not kwargs.get('country_lons'):
            country_lons_data, country_lats_data = self._load_countries_bundled()
            if country_lons_data:
                kwargs['country_lons'] = country_lons_data
                kwargs['country_lats'] = country_lats_data
        
        super().__init__(**kwargs)
    
    @staticmethod
    def _load_coastlines_bundled():
        """Load pre-bundled coastline data (instant!)"""
        try:
            from coastline_data import COAST_LONS, COAST_LATS
            return COAST_LONS, COAST_LATS
        except ImportError:
            print("Warning: coastline_data.py not found")
            print("Generate it by running: python generate_coastline_data.py")
            return [], []
    
    @staticmethod
    def _load_countries_bundled():
        """Load pre-bundled country boundary data (instant!)"""
        try:
            from countries_data import COUNTRY_LONS, COUNTRY_LATS
            return COUNTRY_LONS, COUNTRY_LATS
        except ImportError:
            print("Warning: countries_data.py not found")
            print("Generate it by running: python generate_countries_data.py")
            return [], []