CXX ?= c++
AR ?= ar
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -Werror -Iinclude

BUILD_DIR := build
Z8_DIR := ../third_party/z8lua
Z8_LIB := $(Z8_DIR)/liblua.a
Z8_SOURCES := $(wildcard $(Z8_DIR)/*.c) $(wildcard $(Z8_DIR)/*.h)
CORE_OBJECT := $(BUILD_DIR)/core.o
AUDIO_OBJECT := $(BUILD_DIR)/audio.o
RASTER_OBJECT := $(BUILD_DIR)/raster.o
VM_OBJECT := $(BUILD_DIR)/vm_z8lua.o
CORE_LIBRARY := $(BUILD_DIR)/libp8core.a
TEST_BINARY := $(BUILD_DIR)/core_tests
VM_TEST_BINARY := $(BUILD_DIR)/vm_tests
WASM_OUTPUT_DIR := ../../apps/web/public/kernel
WASM_OUTPUT := $(WASM_OUTPUT_DIR)/aico8-kernel.js
Z8_WASM_SOURCES := $(addprefix $(Z8_DIR)/,lapi.c lcode.c ldebug.c ldo.c ldump.c lfunc.c lgc.c llex.c lmem.c \
	lobject.c lopcodes.c lparser.c lstate.c lstring.c ltable.c ltm.c lundump.c lvm.c lzio.c lctype.c \
	lauxlib.c lbaselib.c lcorolib.c ldblib.c ltablib.c lstrlib.c lpico8lib.c linit.c)

.PHONY: all test wasm wasm-test clean

all: $(CORE_LIBRARY)

test: $(TEST_BINARY) $(VM_TEST_BINARY)
	$(TEST_BINARY)
	$(VM_TEST_BINARY)

wasm: $(WASM_OUTPUT)

wasm-test: wasm $(VM_TEST_BINARY)
	node tests/wasm_smoke.mjs

$(WASM_OUTPUT): Makefile src/core.cpp src/audio.cpp src/audio_internal.h src/raster.cpp src/vm_z8lua.cpp src/wasm_api.cpp \
		include/p8/audio.h include/p8/core.h include/p8/raster.h include/p8/vm.h include/p8/wasm.h $(Z8_WASM_SOURCES)
	mkdir -p $(WASM_OUTPUT_DIR)
	em++ -O3 -std=c++17 -Iinclude -I$(Z8_DIR) -x c++ \
		src/core.cpp src/audio.cpp src/raster.cpp src/vm_z8lua.cpp src/wasm_api.cpp $(Z8_WASM_SOURCES) \
		-fexceptions -sDISABLE_EXCEPTION_CATCHING=0 \
		-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAico8Kernel \
		-sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node -sFILESYSTEM=0 \
		-sEXPORTED_FUNCTIONS='["_malloc","_free","_aico8_create","_aico8_destroy","_aico8_load_cart","_aico8_load_persistent","_aico8_start","_aico8_initialization_complete","_aico8_tick60","_aico8_audio_available","_aico8_read_audio","_aico8_framebuffer","_aico8_framebuffer_size","_aico8_draw_commands","_aico8_draw_command_count","_aico8_draw_payload","_aico8_draw_payload_size","_aico8_copy_map_region","_aico8_get_global_raw","_aico8_get_global_boolean","_aico8_copy_global_string","_aico8_get_table_length","_aico8_get_table_value_raw","_aico8_get_table_entry_raw","_aico8_get_table_entry_boolean","_aico8_copy_menu_item_label","_aico8_menu_item_filter","_aico8_invoke_menu_item","_aico8_copy_persistent","_aico8_last_error","_aico8_diagnostic_output"]' \
		-sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8"]' -o $@

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(CORE_OBJECT): src/core.cpp src/audio_internal.h include/p8/audio.h include/p8/core.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(AUDIO_OBJECT): src/audio.cpp src/audio_internal.h include/p8/audio.h include/p8/core.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(RASTER_OBJECT): src/raster.cpp include/p8/raster.h include/p8/core.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(VM_OBJECT): src/vm_z8lua.cpp include/p8/audio.h include/p8/vm.h include/p8/core.h $(Z8_LIB) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -I$(Z8_DIR) -c $< -o $@

$(CORE_LIBRARY): $(CORE_OBJECT) $(AUDIO_OBJECT) $(RASTER_OBJECT)
	$(AR) rcs $@ $^

$(TEST_BINARY): tests/core_tests.cpp $(CORE_LIBRARY)
	$(CXX) $(CXXFLAGS) $< $(CORE_LIBRARY) -o $@

$(VM_TEST_BINARY): tests/vm_tests.cpp tests/fixtures/synthetic_cart.lua $(VM_OBJECT) $(CORE_LIBRARY) $(Z8_LIB)
	$(CXX) $(CXXFLAGS) $< $(VM_OBJECT) $(CORE_LIBRARY) $(Z8_LIB) -lm -o $@

$(Z8_LIB): $(Z8_SOURCES)
	$(MAKE) -C $(Z8_DIR) CC=$(CXX) MYCFLAGS= MYLDFLAGS= MYLIBS= liblua.a

clean:
	rm -rf $(BUILD_DIR)
