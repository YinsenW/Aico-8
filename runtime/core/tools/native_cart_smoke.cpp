#include "p8/wasm.h"

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct runtime_deleter {
    void operator()(aico8_runtime *runtime) const { aico8_destroy(runtime); }
};

using runtime_pointer = std::unique_ptr<aico8_runtime, runtime_deleter>;

std::map<std::string, std::string> parse_arguments(int argc, char **argv)
{
    if ((argc - 1) % 2 != 0) {
        throw std::runtime_error("arguments must use --name value pairs");
    }
    std::map<std::string, std::string> result;
    for (int index = 1; index < argc; index += 2) {
        const std::string key = argv[index];
        if (key.rfind("--", 0) != 0) {
            throw std::runtime_error("arguments must use --name value pairs");
        }
        result[key.substr(2)] = argv[index + 1];
    }
    return result;
}

const std::string &required(const std::map<std::string, std::string> &arguments,
                            const std::string &name)
{
    const auto found = arguments.find(name);
    if (found == arguments.end() || found->second.empty()) {
        throw std::runtime_error("missing --" + name);
    }
    return found->second;
}

std::vector<uint8_t> read_bytes(const std::filesystem::path &path)
{
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("unable to read " + path.string());
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(input),
                                std::istreambuf_iterator<char>());
}

void write_bytes(const std::filesystem::path &path, const uint8_t *data, size_t size)
{
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("unable to write " + path.string());
    output.write(reinterpret_cast<const char *>(data), static_cast<std::streamsize>(size));
    if (!output) throw std::runtime_error("unable to finish " + path.string());
}

std::vector<std::string> split_names(const std::string &value)
{
    std::vector<std::string> names;
    std::stringstream stream(value);
    std::string name;
    while (std::getline(stream, name, ',')) {
        if (!name.empty()) names.push_back(name);
    }
    return names;
}

std::string json_string(const std::string &value)
{
    std::ostringstream output;
    output << '"';
    for (const unsigned char character : value) {
        switch (character) {
        case '"': output << "\\\""; break;
        case '\\': output << "\\\\"; break;
        case '\b': output << "\\b"; break;
        case '\f': output << "\\f"; break;
        case '\n': output << "\\n"; break;
        case '\r': output << "\\r"; break;
        case '\t': output << "\\t"; break;
        default:
            if (character < 0x20) {
                constexpr char hex[] = "0123456789abcdef";
                output << "\\u00" << hex[character >> 4] << hex[character & 0x0f];
            } else {
                output << character;
            }
        }
    }
    output << '"';
    return output.str();
}

struct execution_result {
    std::string status = "failed";
    size_t host_ticks = 0;
    size_t initialization_ticks = 0;
    size_t logical_updates = 0;
    size_t maximum_draw_command_count = 0;
    size_t audio_sample_count = 0;
    int audio_peak_absolute = 0;
    std::map<std::string, int32_t> observed_numbers;
    std::string failure;
};

void write_metadata(const std::filesystem::path &path, const execution_result &result)
{
    std::ofstream output(path, std::ios::trunc);
    if (!output) throw std::runtime_error("unable to write " + path.string());
    output << "{\n"
           << "  \"schemaVersion\": \"aico8.native-cart-smoke-metadata.v1\",\n"
           << "  \"status\": " << json_string(result.status) << ",\n"
           << "  \"hostTicks\": " << result.host_ticks << ",\n"
           << "  \"initializationTicks\": " << result.initialization_ticks << ",\n"
           << "  \"logicalUpdates\": " << result.logical_updates << ",\n"
           << "  \"maximumDrawCommandCount\": " << result.maximum_draw_command_count << ",\n"
           << "  \"audioSampleCount\": " << result.audio_sample_count << ",\n"
           << "  \"audioPeakAbsolute\": " << result.audio_peak_absolute << ",\n"
           << "  \"observedNumberRaw16_16\": {";
    bool first = true;
    for (const auto &[name, value] : result.observed_numbers) {
        output << (first ? "\n" : ",\n") << "    " << json_string(name) << ": " << value;
        first = false;
    }
    if (!first) output << '\n';
    output << "  }";
    if (!result.failure.empty()) {
        output << ",\n  \"failure\": " << json_string(result.failure);
    }
    output << "\n}\n";
    if (!output) throw std::runtime_error("unable to finish " + path.string());
}

void write_pcm_sample(std::ofstream &output, int16_t sample)
{
    const uint16_t bits = static_cast<uint16_t>(sample);
    const uint8_t bytes[] = {
        static_cast<uint8_t>(bits & 0xffu),
        static_cast<uint8_t>((bits >> 8u) & 0xffu),
    };
    output.write(reinterpret_cast<const char *>(bytes), 2);
}

} // namespace

int main(int argc, char **argv)
{
    std::filesystem::path output_directory;
    execution_result result;
    try {
        const auto arguments = parse_arguments(argc, argv);
        output_directory = required(arguments, "out-directory");
        std::filesystem::create_directories(output_directory);
        const auto rom = read_bytes(required(arguments, "rom"));
        const auto source_bytes = read_bytes(required(arguments, "source"));
        const auto buttons = read_bytes(required(arguments, "buttons"));
        const size_t target_updates = std::stoull(required(arguments, "target-updates"));
        if (rom.size() != 0x8000) throw std::runtime_error("ROM must be exactly 32768 bytes");
        if (source_bytes.empty()) throw std::runtime_error("Lua source must not be empty");
        if (buttons.size() != target_updates) {
            throw std::runtime_error("button stream length must equal target updates");
        }
        for (const uint8_t mask : buttons) {
            if (mask > 63) throw std::runtime_error("button masks must be between 0 and 63");
        }

        runtime_pointer runtime(aico8_create());
        if (!runtime) throw std::runtime_error("native runtime creation failed");
        const std::string source(source_bytes.begin(), source_bytes.end());
        if (!aico8_load_cart(runtime.get(), rom.data(), rom.size(), source.data(), source.size())) {
            throw std::runtime_error(aico8_last_error(runtime.get()));
        }
        const std::vector<uint8_t> clean_persistence(256, 0);
        if (!aico8_load_persistent(runtime.get(), clean_persistence.data(), clean_persistence.size())) {
            throw std::runtime_error("native persistence load failed");
        }
        if (!aico8_start(runtime.get())) throw std::runtime_error(aico8_last_error(runtime.get()));
        result.maximum_draw_command_count = aico8_draw_command_count(runtime.get());

        std::ofstream pcm(output_directory / "audio.pcm16le", std::ios::binary | std::ios::trunc);
        if (!pcm) throw std::runtime_error("unable to create native PCM output");
        std::vector<int16_t> audio(2048);
        const size_t maximum_host_ticks = target_updates * 2 + 36000;
        while (result.logical_updates < target_updates) {
            if (result.host_ticks >= maximum_host_ticks) {
                throw std::runtime_error("native replay exceeded its bounded host-tick budget");
            }
            const bool initialized_before_tick = aico8_initialization_complete(runtime.get()) == 1;
            const uint8_t mask = initialized_before_tick ? buttons[result.logical_updates] : 0;
            const int updated = aico8_tick60(runtime.get(), mask);
            ++result.host_ticks;
            if (updated < 0) throw std::runtime_error(aico8_last_error(runtime.get()));
            while (aico8_audio_available(runtime.get()) > 0) {
                const size_t count = aico8_read_audio(runtime.get(), audio.data(), audio.size());
                if (count == 0 || count > audio.size()) {
                    throw std::runtime_error("native audio queue did not drain");
                }
                for (size_t index = 0; index < count; ++index) {
                    write_pcm_sample(pcm, audio[index]);
                    result.audio_peak_absolute = std::max(
                        result.audio_peak_absolute,
                        std::abs(static_cast<int>(audio[index])));
                }
                result.audio_sample_count += count;
            }
            if (updated == 1 && initialized_before_tick) ++result.logical_updates;
            if (!initialized_before_tick) ++result.initialization_ticks;
            result.maximum_draw_command_count = std::max(
                result.maximum_draw_command_count,
                aico8_draw_command_count(runtime.get()));
        }
        pcm.close();
        if (!pcm) throw std::runtime_error("unable to finish native PCM output");
        if (!aico8_initialization_complete(runtime.get())) {
            throw std::runtime_error("native initialization did not complete");
        }

        const uint8_t *framebuffer = aico8_framebuffer(runtime.get());
        write_bytes(output_directory / "framebuffer.bin", framebuffer,
                    aico8_framebuffer_size());
        std::vector<uint8_t> persistent(256);
        if (aico8_copy_persistent(runtime.get(), persistent.data(), persistent.size())
            != persistent.size()) {
            throw std::runtime_error("native persistence copy failed");
        }
        write_bytes(output_directory / "persistence.bin", persistent.data(), persistent.size());
        const auto observe = arguments.find("observe-numbers");
        if (observe != arguments.end()) {
            for (const std::string &name : split_names(observe->second)) {
                int32_t value = 0;
                if (aico8_get_global_raw(runtime.get(), name.c_str(), &value)) {
                    result.observed_numbers[name] = value;
                }
            }
        }
        result.status = "passed";
        write_metadata(output_directory / "metadata.json", result);
        std::cout << "Native cart smoke: PASS (" << result.logical_updates
                  << " logical updates, " << result.maximum_draw_command_count
                  << " max draw commands)\n";
        return 0;
    } catch (const std::exception &error) {
        result.failure = error.what();
        if (!output_directory.empty()) {
            try {
                std::filesystem::create_directories(output_directory);
                write_metadata(output_directory / "metadata.json", result);
            } catch (...) {
            }
        }
        std::cerr << "Native cart smoke: FAIL: " << error.what() << '\n';
        return 1;
    }
}
