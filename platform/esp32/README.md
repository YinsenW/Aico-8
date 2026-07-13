# Aico 8 ESP32-P4 host

Planned ESP-IDF C++ target for a low-cost dedicated device:

- the same native compatibility core and fixed-step replay contract;
- LCD, audio, storage, controller, sleep/wake, and firmware-update adapters;
- packed reference-profile semantic assets converted to the selected panel format;
- strip/tile rendering and deterministic memory budgets instead of requiring a
  full 1024×1024 RGBA framebuffer in PSRAM;
- no JavaScript VM on the device.

ESP32-P4 is the initial hardware baseline. Smaller ESP32 variants are later
constrained profiles, not the compatibility target.
