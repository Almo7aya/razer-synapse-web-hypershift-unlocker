import { deflateSync } from 'node:zlib';
import { crc32 } from './binary.mjs';

function chunk(type, data) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
}

// Original keyboard/open-lock icon. Supersampling keeps small sizes legible.
export function createIcon(size) {
    const rounded = (x, y, left, top, width, height, radius) => {
        const dx = Math.max(left + radius - x, 0, x - left - width + radius);
        const dy = Math.max(top + radius - y, 0, y - top - height + radius);
        return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius;
    };
    const pixel = (x, y) => {
        if (!rounded(x, y, 0, 0, 128, 128, 26)) return [0, 0, 0, 0];
        const green = [118, 229, 181, 255], dark = [22, 38, 31, 255];
        if (rounded(x, y, 16, 56, 96, 54, 9) && !rounded(x, y, 20, 60, 88, 46, 6)) return green;
        for (const row of [68, 82]) for (const col of [29, 46, 63, 80, 97]) {
            if (rounded(x, y, col - 4, row, 9, 6, 1)) return green;
        }
        if (rounded(x, y, 42, 96, 44, 5, 2)) return green;
        const distance = Math.hypot(x - 63, y - 31);
        if (y <= 31 && distance >= 13 && distance <= 18) return green;
        if (x >= 45 && x <= 50 && y >= 30 && y <= 43) return green;
        if (rounded(x, y, 42, 39, 42, 29, 5)) {
            if (Math.hypot(x - 63, y - 51) < 4 || (x > 61 && x < 65 && y >= 51 && y < 59)) return dark;
            return green;
        }
        return dark;
    };
    const bytes = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const sum = [0, 0, 0, 0];
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const color = pixel((x + (sx + .5) / 4) * 128 / size, (y + (sy + .5) / 4) * 128 / size);
            for (let channel = 0; channel < 4; channel++) sum[channel] += color[channel];
        }
        for (let channel = 0; channel < 4; channel++) bytes[y * (size * 4 + 1) + 1 + x * 4 + channel] = Math.round(sum[channel] / 16);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
    header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
