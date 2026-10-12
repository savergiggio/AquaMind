#!/usr/bin/env python3
"""
Chihiros LED Control Daemon for AquaMind
Uses savergiggio/chihiros-led-control fork (works without Home Assistant)
"""

import asyncio
import json
import sys
import traceback
from bleak import BleakScanner

# Import from user's fork
sys.path.insert(0, '/app/chihiros-led-control/custom_components/chihiros')
from chihiros_led_control.device import get_device_from_address

# Global connection state
_device = None
_connected_address = None


async def ensure_connected(address):
    """Get or create device connection"""
    global _device, _connected_address
    
    if _device and _connected_address == address:
        try:
            # Check if still connected
            if hasattr(_device, '_client') and _device._client and _device._client.is_connected:
                return _device
        except:
            pass
    
    # Create new connection
    _device = await get_device_from_address(address)
    _connected_address = address
    return _device


async def scan_devices(timeout=10):
    devices = []
    discovered = await BleakScanner.discover(timeout=timeout)
    for d in discovered:
        name = d.name or 'Unknown'
        is_chihiros = is_rgb = False
        if d.name:
            up = d.name.upper()
            if any(x in up for x in ['CHIHIROS', 'WRGB', 'DYSL', 'CDE', 'RGB']):
                is_chihiros = True
                if 'RGB' in up or 'WRGB' in up or 'DYSL' in up:
                    is_rgb = True
        devices.append({'name': name, 'address': d.address, 'is_chihiros': is_chihiros, 'is_rgb': is_rgb})
    return devices


async def control(address, command, **kwargs):
    """Execute command using the library"""
    global _device, _connected_address
    
    try:
        device = await ensure_connected(address)
        
        print(f"[DEBUG] Command: {command}", file=sys.stderr, flush=True)
        print(f"[DEBUG] Params: {kwargs}", file=sys.stderr, flush=True)
        
        if command == 'turn_on':
            await device.turn_on()
        elif command == 'turn_off':
            await device.turn_off()
        elif command == 'set_brightness':
            await device.set_brightness(kwargs.get('brightness', 50))
        elif command == 'set_rgb':
            r, g, b = kwargs.get('red', 50), kwargs.get('green', 50), kwargs.get('blue', 50)
            await device.set_rgb_brightness((r, g, b))
        elif command == 'set_channel':
            ch, br = kwargs.get('channel', 0), kwargs.get('brightness', 50)
            await device.set_color_brightness(br, ch)
        elif command == 'enable_auto_mode':
            await device.enable_auto_mode()
        elif command == 'reset_settings':
            await device.reset_settings()
        else:
            return {'success': False, 'error': f'Unknown: {command}'}
        
        return {'success': True, 'command': command}
        
    except Exception as e:
        # Clear connection on error
        _device = None
        _connected_address = None
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


async def disconnect():
    global _device, _connected_address
    if _device and hasattr(_device, 'disconnect'):
        try:
            await _device.disconnect()
        except:
            pass
    _device = None
    _connected_address = None
    return {'success': True}


async def process_stdin():
    """Daemon mode - reads JSON from stdin"""
    print(json.dumps({'type': 'ready', 'library': 'savergiggio/chihiros-led-control'}), flush=True)
    
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    
    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            line = line.decode().strip()
            if not line:
                continue
            
            cmd = json.loads(line)
            action = cmd.get('action')
            
            if action == 'scan':
                devices = await scan_devices(cmd.get('timeout', 10))
                print(json.dumps({'success': True, 'devices': devices}), flush=True)
            elif action == 'control':
                result = await control(cmd.get('address'), cmd.get('command'), **cmd.get('params', {}))
                print(json.dumps(result), flush=True)
            elif action == 'disconnect':
                result = await disconnect()
                print(json.dumps(result), flush=True)
            elif action == 'ping':
                print(json.dumps({'success': True, 'connected': _device is not None}), flush=True)
            else:
                print(json.dumps({'success': False, 'error': f'Unknown action'}), flush=True)
        except json.JSONDecodeError as e:
            print(json.dumps({'success': False, 'error': f'JSON: {e}'}), flush=True)
        except Exception as e:
            print(json.dumps({'success': False, 'error': str(e)}), flush=True)


def main():
    if len(sys.argv) > 1 and sys.argv[1] not in ['daemon', '']:
        # CLI mode
        if sys.argv[1] == 'scan':
            print(json.dumps({'success': True, 'devices': asyncio.run(scan_devices(int(sys.argv[2]) if len(sys.argv) > 2 else 10))}))
        elif sys.argv[1] == 'control' and len(sys.argv) >= 4:
            kwargs = {}
            cmd = sys.argv[3]
            if cmd == 'set_brightness' and len(sys.argv) > 4:
                kwargs['brightness'] = int(sys.argv[4])
            elif cmd == 'set_channel' and len(sys.argv) > 5:
                kwargs['channel'] = int(sys.argv[4])
                kwargs['brightness'] = int(sys.argv[5])
            elif cmd == 'set_rgb' and len(sys.argv) > 6:
                kwargs['red'] = int(sys.argv[4])
                kwargs['green'] = int(sys.argv[5])
                kwargs['blue'] = int(sys.argv[6])
            print(json.dumps(asyncio.run(control(sys.argv[2], cmd, **kwargs))))
        elif sys.argv[1] == 'test':
            print(json.dumps({'success': True, 'message': 'Using savergiggio/chihiros-led-control'}))
        else:
            print(json.dumps({'error': 'Unknown'}))
    else:
        asyncio.run(process_stdin())


if __name__ == '__main__':
    main()
