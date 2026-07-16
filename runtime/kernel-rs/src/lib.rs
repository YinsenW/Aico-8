#![cfg_attr(any(target_arch = "wasm32", target_os = "none"), no_std)]

use core::cell::UnsafeCell;

pub const RAM_SIZE: usize = 65_536;
const CHECKPOINT_WORDS: usize = 8;

#[repr(C, align(16))]
pub struct Runtime {
    ram: [u8; RAM_SIZE],
    tick: u32,
    rng: u32,
    player_x: i32,
    player_y: i32,
    buttons: u8,
}

impl Runtime {
    pub const fn new() -> Self {
        Self {
            ram: [0; RAM_SIZE],
            tick: 0,
            rng: 0,
            player_x: 0,
            player_y: 0,
            buttons: 0,
        }
    }

    pub fn reset(&mut self, seed: u32) {
        self.ram.fill(0);
        self.tick = 0;
        self.rng = if seed == 0 { 0xdead_beef } else { seed };
        self.player_x = 64 << 16;
        self.player_y = 64 << 16;
        self.buttons = 0;
        self.write_observable_state();
    }

    pub fn step(&mut self, buttons: u8) {
        self.tick = self.tick.wrapping_add(1);
        self.buttons = buttons & 0x3f;
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;

        let dx = i32::from(self.buttons & 0x02 != 0) - i32::from(self.buttons & 0x01 != 0);
        let dy = i32::from(self.buttons & 0x08 != 0) - i32::from(self.buttons & 0x04 != 0);
        self.player_x = self.player_x.wrapping_add(dx << 14);
        self.player_y = self.player_y.wrapping_add(dy << 14);

        let address = (self.rng as usize ^ self.tick as usize) & 0x7fff;
        self.ram[address] = self.ram[address]
            .wrapping_add(self.buttons)
            .wrapping_add(self.tick as u8);
        self.write_observable_state();
    }

    pub fn checkpoint_words(&self) -> [u32; CHECKPOINT_WORDS] {
        let mut output = [0; CHECKPOINT_WORDS];
        for lane in 0..4 {
            let mut hash =
                0xcbf2_9ce4_8422_2325u64 ^ (lane as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            for (index, byte) in self.ram.iter().copied().enumerate() {
                hash ^= u64::from(byte) ^ ((index as u64 + lane as u64) & 0xff);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
            for byte in self
                .tick
                .to_le_bytes()
                .into_iter()
                .chain(self.rng.to_le_bytes())
                .chain(self.player_x.to_le_bytes())
                .chain(self.player_y.to_le_bytes())
                .chain([self.buttons])
            {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
            output[lane * 2] = hash as u32;
            output[lane * 2 + 1] = (hash >> 32) as u32;
        }
        output
    }

    fn write_observable_state(&mut self) {
        self.ram[0x5f00..0x5f04].copy_from_slice(&self.tick.to_le_bytes());
        self.ram[0x5f44..0x5f48].copy_from_slice(&self.rng.to_le_bytes());
        self.ram[0x5f78..0x5f7c].copy_from_slice(&self.player_x.to_le_bytes());
        self.ram[0x5f7c..0x5f80].copy_from_slice(&self.player_y.to_le_bytes());
        self.ram[0x5f80] = self.buttons;
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

struct RuntimeCell(UnsafeCell<Runtime>);

// SAFETY: the proof ABI is single-threaded on every selected host. Hosts must serialize calls.
unsafe impl Sync for RuntimeCell {}

static RUNTIME: RuntimeCell = RuntimeCell(UnsafeCell::new(Runtime::new()));

fn runtime() -> &'static mut Runtime {
    // SAFETY: the exported proof ABI is explicitly single-threaded and non-reentrant.
    unsafe { &mut *RUNTIME.0.get() }
}

#[unsafe(no_mangle)]
pub extern "C" fn aico8_spike_reset(seed: u32) {
    runtime().reset(seed);
}

#[unsafe(no_mangle)]
pub extern "C" fn aico8_spike_step(buttons: u32) {
    runtime().step(buttons as u8);
}

#[unsafe(no_mangle)]
pub extern "C" fn aico8_spike_checkpoint_word(index: u32) -> u32 {
    runtime()
        .checkpoint_words()
        .get(index as usize)
        .copied()
        .unwrap_or(0)
}

#[cfg(all(
    feature = "z8lua-native",
    not(any(target_arch = "wasm32", target_os = "none"))
))]
mod z8lua {
    unsafe extern "C" {
        fn aico8_z8lua_native_probe() -> i32;
    }

    pub fn probe() -> i32 {
        // SAFETY: the bridge owns and closes its temporary Lua state.
        unsafe { aico8_z8lua_native_probe() }
    }
}

#[cfg(all(
    feature = "z8lua-native",
    not(any(target_arch = "wasm32", target_os = "none"))
))]
pub fn z8lua_native_probe() -> i32 {
    z8lua::probe()
}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::string::String;
    use std::vec::Vec;

    fn trace() -> (u32, Vec<u8>, String) {
        let mut seed = 0;
        let mut buttons = Vec::new();
        let mut expected = String::new();
        for line in include_str!("../../../tests/conformance/input_traces/kernel_spike.txt").lines()
        {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (key, value) = line.split_once(' ').expect("key and value");
            match key {
                "seed" => seed = u32::from_str_radix(value.trim_start_matches("0x"), 16).unwrap(),
                "buttons" => buttons.push(value.parse().unwrap()),
                "expected" => expected = value.to_owned(),
                _ => panic!("unknown trace key"),
            }
        }
        (seed, buttons, expected)
    }

    fn checkpoint_hex(words: [u32; CHECKPOINT_WORDS]) -> String {
        words
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .map(|byte| std::format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn trace_checkpoint_is_stable() {
        let (seed, buttons, expected) = trace();
        let mut first = Runtime::new();
        let mut second = Runtime::new();
        first.reset(seed);
        second.reset(seed);
        for button in buttons {
            first.step(button);
            second.step(button);
        }
        assert_eq!(first.checkpoint_words(), second.checkpoint_words());
        assert_eq!(checkpoint_hex(first.checkpoint_words()), expected);
    }

    #[cfg(feature = "z8lua-native")]
    #[test]
    fn rust_links_and_executes_z8lua_natively() {
        assert_eq!(z8lua_native_probe(), 42);
    }
}
