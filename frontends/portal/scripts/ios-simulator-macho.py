"""Read simulated entitlement sections from both universal Mach-O slices."""
from pathlib import Path
import struct


CPU_NAMES = {0x0100000C: 'arm64', 0x01000007: 'x86_64'}


def entitlement_sections(binary):
    data = Path(binary).read_bytes()
    if len(data) < 8 or data[:4] not in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        raise ValueError('Expected a universal simulator Mach-O')
    wide = data[:4] == b'\xca\xfe\xba\xbf'
    count = struct.unpack_from('>I', data, 4)[0]
    stride = 32 if wide else 20
    if count != 2 or 8 + count * stride > len(data):
        raise ValueError('Expected exactly two simulator architectures')
    result = {}
    for index in range(count):
        record = 8 + index * stride
        cpu = struct.unpack_from('>I', data, record)[0]
        offset, size = struct.unpack_from('>QQ' if wide else '>II', data, record + 8)
        architecture = CPU_NAMES.get(cpu)
        if not architecture or architecture in result or offset + size > len(data) or size < 32:
            raise ValueError('Invalid simulator architecture range')
        thin = data[offset:offset + size]
        if thin[:4] != b'\xcf\xfa\xed\xfe' or struct.unpack_from('<I', thin, 4)[0] != cpu:
            raise ValueError('Invalid simulator Mach-O header')
        commands, command_bytes = struct.unpack_from('<II', thin, 16)
        if command_bytes > size - 32:
            raise ValueError('Invalid Mach-O load commands')
        position = 32
        found = {}
        for _ in range(commands):
            if position + 8 > 32 + command_bytes:
                raise ValueError('Truncated Mach-O command')
            command, length = struct.unpack_from('<II', thin, position)
            if length < 8 or position + length > 32 + command_bytes:
                raise ValueError('Invalid Mach-O command length')
            if command == 0x19:
                if length < 72:
                    raise ValueError('Truncated Mach-O segment')
                sections = struct.unpack_from('<I', thin, position + 64)[0]
                if 72 + 80 * sections > length:
                    raise ValueError('Truncated Mach-O sections')
                for section_index in range(sections):
                    section = position + 72 + 80 * section_index
                    name = thin[section:section + 16].rstrip(b'\0').decode('ascii')
                    segment = thin[section + 16:section + 32].rstrip(b'\0').decode('ascii')
                    if segment == '__TEXT' and name in ('__entitlements', '__ents_der'):
                        section_size = struct.unpack_from('<Q', thin, section + 40)[0]
                        file_offset = struct.unpack_from('<I', thin, section + 48)[0]
                        if name in found or not section_size or file_offset + section_size > size:
                            raise ValueError('Invalid simulated entitlement section')
                        found[name] = thin[file_offset:file_offset + section_size]
            position += length
        if set(found) != {'__entitlements', '__ents_der'}:
            raise ValueError(f'{architecture} is missing linker-embedded simulated entitlements')
        result[architecture] = found
    return result
