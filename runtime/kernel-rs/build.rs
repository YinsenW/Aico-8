use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    if env::var_os("CARGO_FEATURE_Z8LUA_NATIVE").is_none() {
        return;
    }

    let target = env::var("TARGET").expect("Cargo provides TARGET");
    if target.contains("wasm32") || target.contains("unknown-none") {
        panic!("z8lua-native is a native-only proof feature");
    }

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let z8lua = manifest.join("../third_party/z8lua");
    let output = PathBuf::from(env::var("OUT_DIR").expect("Cargo provides OUT_DIR"));
    let cxx = env::var("CXX").unwrap_or_else(|_| "c++".to_owned());
    let status = Command::new("make")
        .arg("-C")
        .arg(&z8lua)
        .arg(format!("CC={cxx}"))
        .arg("MYCFLAGS=")
        .arg("MYLDFLAGS=")
        .arg("MYLIBS=")
        .arg("liblua.a")
        .status()
        .expect("run z8lua make");
    assert!(status.success(), "z8lua native library build failed");

    let bridge_object = output.join("z8lua_bridge.o");
    let status = Command::new(&cxx)
        .arg("-std=c++17")
        .arg(format!("-I{}", z8lua.display()))
        .arg("-c")
        .arg(manifest.join("src/z8lua_bridge.cpp"))
        .arg("-o")
        .arg(&bridge_object)
        .status()
        .expect("compile z8lua bridge");
    assert!(status.success(), "z8lua bridge compilation failed");
    let bridge_library = output.join("libaico8_z8lua_bridge.a");
    let status = Command::new("ar")
        .arg("rcs")
        .arg(&bridge_library)
        .arg(&bridge_object)
        .status()
        .expect("archive z8lua bridge");
    assert!(status.success(), "z8lua bridge archive failed");

    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-search=native={}", z8lua.display());
    println!("cargo:rustc-link-lib=static=aico8_z8lua_bridge");
    println!("cargo:rustc-link-lib=static=lua");
    if target.contains("apple") {
        println!("cargo:rustc-link-lib=dylib=c++");
    } else {
        println!("cargo:rustc-link-lib=dylib=stdc++");
    }

    println!("cargo:rerun-if-changed=../third_party/z8lua.lock.json");
    println!("cargo:rerun-if-changed=src/z8lua_bridge.cpp");
    println!("cargo:rerun-if-env-changed=CXX");
}
