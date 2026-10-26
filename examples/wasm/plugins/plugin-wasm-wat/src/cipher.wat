(module
  ;; Linear memory exported to host/plugin JS (1 page = 64KB)
  (memory (export "memory") 1)

  ;; In-place XOR encoding/decoding: modifies byte buffer at ptr of length len with key
  (func (export "xor_cipher") (param $ptr i32) (param $len i32) (param $key i32) (result i32)
    (local $i i32)
    (local $byte_val i32)
    (local.set $i (i32.const 0))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        ;; load byte from memory at ptr + i
        (local.set $byte_val
          (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))
        )
        ;; xor with (key & 0xFF)
        (local.set $byte_val
          (i32.xor (local.get $byte_val) (local.get $key))
        )
        ;; store back to memory
        (i32.store8
          (i32.add (local.get $ptr) (local.get $i))
          (local.get $byte_val)
        )
        ;; i++
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $len)
  )

  ;; In-place ROT13 cipher for ASCII strings
  (func (export "rot13") (param $ptr i32) (param $len i32) (result i32)
    (local $i i32)
    (local $ch i32)
    (local.set $i (i32.const 0))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $ch
          (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))
        )
        ;; Check if lowercase 'a' (97) <= ch <= 'z' (122)
        (if (i32.and (i32.ge_u (local.get $ch) (i32.const 97)) (i32.le_u (local.get $ch) (i32.const 122)))
          (then
            (i32.store8
              (i32.add (local.get $ptr) (local.get $i))
              (i32.add (i32.const 97) (i32.rem_u (i32.add (i32.sub (local.get $ch) (i32.const 97)) (i32.const 13)) (i32.const 26)))
            )
          )
          (else
            ;; Check if uppercase 'A' (65) <= ch <= 'Z' (90)
            (if (i32.and (i32.ge_u (local.get $ch) (i32.const 65)) (i32.le_u (local.get $ch) (i32.const 90)))
              (then
                (i32.store8
                  (i32.add (local.get $ptr) (local.get $i))
                  (i32.add (i32.const 65) (i32.rem_u (i32.add (i32.sub (local.get $ch) (i32.const 65)) (i32.const 13)) (i32.const 26)))
                )
              )
            )
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $len)
  )

  ;; 16-bit CRC checksum calculation over buffer in memory
  (func (export "crc16") (param $ptr i32) (param $len i32) (result i32)
    (local $crc i32)
    (local $i i32)
    (local.set $crc (i32.const 65535)) ;; 0xFFFF
    (local.set $i (i32.const 0))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $crc
          (i32.and
            (i32.xor
              (i32.mul (local.get $crc) (i32.const 31))
              (i32.load8_u (i32.add (local.get $ptr) (local.get $i)))
            )
            (i32.const 65535)
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    (local.get $crc)
  )
)
