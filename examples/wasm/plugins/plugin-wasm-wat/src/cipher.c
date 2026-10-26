/**
 * cipher.c - Reference C implementation of the cipher routines.
 * 
 * This file corresponds directly to cipher.wat.
 * In a native C-to-WASM workflow (e.g., clang or emscripten), this source
 * would compile with:
 *   clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all -O3 cipher.c -o cipher.wasm
 */

#define MEMORY_SIZE 65536
static unsigned char memory[MEMORY_SIZE];

unsigned char* get_memory(void) {
    return memory;
}

int xor_cipher(int ptr, int len, int key) {
    for (int i = 0; i < len; i++) {
        memory[ptr + i] ^= (unsigned char)(key & 0xFF);
    }
    return len;
}

int rot13(int ptr, int len) {
    for (int i = 0; i < len; i++) {
        unsigned char ch = memory[ptr + i];
        if (ch >= 'a' && ch <= 'z') {
            memory[ptr + i] = 'a' + ((ch - 'a' + 13) % 26);
        } else if (ch >= 'A' && ch <= 'Z') {
            memory[ptr + i] = 'A' + ((ch - 'A' + 13) % 26);
        }
    }
    return len;
}

int crc16(int ptr, int len) {
    int crc = 0xFFFF;
    for (int i = 0; i < len; i++) {
        crc = ((crc * 31) ^ memory[ptr + i]) & 0xFFFF;
    }
    return crc;
}
