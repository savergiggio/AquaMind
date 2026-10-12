#!/usr/bin/env python3
"""
Chihiros LED Control Wrapper for AquaMind
Uses the chihiros_led_control library directly (not CLI)
"""

import asyncio
import json
import sys
import traceback

# Add library path
sys.path.insert(0, '/app/chihiros-led-control-main/custom_components/chihiros')

from bleak import BleakScanner

# Import the device module directly (bypassing Home Assistant integration)
try:
    from chihiros_led_control.device import get_device_from_address, get_model_class_from_name
    LIBRARY_AVAILABLE = True
except ImportError as e:
    print(f"Library import error: {e}", file=sys.stderr)
    LIBRARY_AVAILABLE = False


async def scan_devices(timeout=10):
    """Scan for BLE devices"""
    devices = []
    discovered = await BleakScanner.discover(timeout=timeout)
    
    for device in discovered:
        name = device.name or 'Unknown'
        is_chihiros = False
        is_rgb = False
        
        if device.name:
            name_upper = device.name.upper()
            if any(x in name_upper for x in ['CHIHIROS', 'WRGB', 'DYSL', 'CDE', 'RGB']):
                is_chihiros = True
                # DYSL devices are WRGB2 SLIM models - they have RGB channels
                if 'RGB' in name_upper or 'WRGB' in name_upper or 'DYSL' in name_upper:
                    is_rgb = True
        
        devices.append({
            'name': name,
            'address': device.address,
            'model': 'Chihiros' if is_chihiros else 'unknown',
            'is_chihiros': is_chihiros,
            'is_rgb': is_rgb
        })
    
    return devices


async def control_device(address, command, **kwargs):
    """Execute a command on the device using the library directly"""
    if not LIBRARY_AVAILABLE:
        return {'success': False, 'error': 'Chihiros library not available'}
    
    try:
        # Quick scan to refresh BlueZ cache (prevents 'device disappeared' error)
        await BleakScanner.discover(timeout=2.0)
        
        # Get device instance
        device = await get_device_from_address(address)
        
        if command == 'turn_on':
            await device.turn_on()
            return {'success': True, 'command': 'turn_on'}
        
        elif command == 'turn_off':
            await device.turn_off()
            return {'success': True, 'command': 'turn_off'}
        
        elif command == 'set_brightness':
            brightness = kwargs.get('brightness', 50)
            # For RGB models, set_color_brightness sets one channel at a time
            # Color 0 = white/red, 1 = green, 2 = blue
            if hasattr(device, 'set_color_brightness'):
                await device.set_color_brightness(color=0, brightness=brightness)
            return {'success': True, 'command': 'set_brightness', 'brightness': brightness}
        
        elif command == 'set_rgb':
            r = kwargs.get('red', 50)
            g = kwargs.get('green', 50)
            b = kwargs.get('blue', 50)
            if hasattr(device, 'set_rgb_brightness'):
                await device.set_rgb_brightness(brightness=(r, g, b))
            else:
                # Fallback: set each channel separately
                if hasattr(device, 'set_color_brightness'):
                    await device.set_color_brightness(color=0, brightness=r)
                    await asyncio.sleep(0.1)
                    await device.set_color_brightness(color=1, brightness=g)
                    await asyncio.sleep(0.1)
                    await device.set_color_brightness(color=2, brightness=b)
            return {'success': True, 'command': 'set_rgb', 'rgb': [r, g, b]}
        
        elif command == 'set_channel':
            channel = kwargs.get('channel', 0)  # 0=Red, 1=Green, 2=Blue
            brightness = kwargs.get('brightness', 50)
            if hasattr(device, 'set_color_brightness'):
                await device.set_color_brightness(color=channel, brightness=brightness)
            return {'success': True, 'command': 'set_channel', 'channel': channel, 'brightness': brightness}
        
        elif command == 'enable_auto_mode':
            if hasattr(device, 'enable_auto_mode'):
                await device.enable_auto_mode()
            return {'success': True, 'command': 'enable_auto_mode'}
        
        elif command == 'reset_settings':
            if hasattr(device, 'reset_settings'):
                await device.reset_settings()
            return {'success': True, 'command': 'reset_settings'}
        
        elif command == 'add_schedule':
            sunrise_h = kwargs.get('sunrise_hour', 8)
            sunrise_m = kwargs.get('sunrise_minute', 0)
            sunset_h = kwargs.get('sunset_hour', 18)
            sunset_m = kwargs.get('sunset_minute', 0)
            brightness = kwargs.get('brightness', 100)
            ramp = kwargs.get('ramp_minutes', 0)
            weekdays = kwargs.get('weekdays', 127)  # All days
            
            if hasattr(device, 'add_setting'):
                # Convert weekdays bitmask to list of days
                from datetime import time
                sunrise = time(hour=sunrise_h, minute=sunrise_m)
                sunset = time(hour=sunset_h, minute=sunset_m)
                await device.add_setting(
                    sunrise=sunrise,
                    sunset=sunset,
                    ramp_up_in_minutes=ramp,
                    weekdays=weekdays,
                    max_brightness=(brightness, brightness, brightness)
                )
            return {'success': True, 'command': 'add_schedule'}
        
        else:
            return {'success': False, 'error': f'Unknown command: {command}'}
            
    except Exception as e:
        return {
            'success': False, 
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No command specified'}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    try:
        if command == 'scan':
            timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 10
            result = asyncio.run(scan_devices(timeout))
            print(json.dumps({'success': True, 'devices': result}))
            
        elif command == 'control':
            if len(sys.argv) < 4:
                print(json.dumps({'error': 'Usage: control <address> <command> [params...]'}))
                sys.exit(1)
            
            address = sys.argv[2]
            ctrl_command = sys.argv[3]
            
            # Parse parameters based on command
            kwargs = {}
            if ctrl_command == 'set_brightness' and len(sys.argv) > 4:
                kwargs['brightness'] = int(sys.argv[4])
            elif ctrl_command == 'set_rgb' and len(sys.argv) > 6:
                kwargs['red'] = int(sys.argv[4])
                kwargs['green'] = int(sys.argv[5])
                kwargs['blue'] = int(sys.argv[6])
            elif ctrl_command == 'set_channel' and len(sys.argv) > 5:
                kwargs['channel'] = int(sys.argv[4])
                kwargs['brightness'] = int(sys.argv[5])
            elif ctrl_command == 'turn_on' and len(sys.argv) > 4:
                kwargs['brightness'] = int(sys.argv[4])
            elif ctrl_command == 'add_schedule' and len(sys.argv) > 8:
                kwargs['sunrise_hour'] = int(sys.argv[4])
                kwargs['sunrise_minute'] = int(sys.argv[5])
                kwargs['sunset_hour'] = int(sys.argv[6])
                kwargs['sunset_minute'] = int(sys.argv[7])
                if len(sys.argv) > 8:
                    kwargs['brightness'] = int(sys.argv[8])
                if len(sys.argv) > 9:
                    kwargs['ramp_minutes'] = int(sys.argv[9])
                if len(sys.argv) > 10:
                    kwargs['weekdays'] = int(sys.argv[10])
            
            result = asyncio.run(control_device(address, ctrl_command, **kwargs))
            print(json.dumps(result))
            
        elif command == 'test':
            print(json.dumps({
                'success': True, 
                'message': 'Chihiros wrapper ready',
                'library_available': LIBRARY_AVAILABLE
            }))
            
        else:
            print(json.dumps({'error': f'Unknown command: {command}'}))
            sys.exit(1)
            
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e), 'traceback': traceback.format_exc()}))
        sys.exit(1)


if __name__ == '__main__':
    main()
