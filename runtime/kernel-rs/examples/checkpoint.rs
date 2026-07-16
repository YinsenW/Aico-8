use aico8_kernel_spike::Runtime;

fn main() {
    let mut runtime = Runtime::new();
    let trace = include_str!("../../../tests/conformance/input_traces/kernel_spike.txt");
    for line in trace.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with("expected ") {
            continue;
        }
        let (key, value) = line.split_once(' ').expect("key and value");
        match key {
            "seed" => {
                runtime.reset(u32::from_str_radix(value.trim_start_matches("0x"), 16).unwrap())
            }
            "buttons" => runtime.step(value.parse().unwrap()),
            _ => panic!("unknown trace key"),
        }
    }
    for word in runtime.checkpoint_words() {
        for byte in word.to_le_bytes() {
            print!("{byte:02x}");
        }
    }
    println!();
}
