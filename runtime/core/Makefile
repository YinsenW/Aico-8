CXX ?= c++
AR ?= ar
CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -Werror -Iinclude

BUILD_DIR := build
Z8_DIR := ../third_party/z8lua
Z8_LIB := $(Z8_DIR)/liblua.a
Z8_SOURCES := $(wildcard $(Z8_DIR)/*.c) $(wildcard $(Z8_DIR)/*.h)
CORE_OBJECT := $(BUILD_DIR)/core.o
RASTER_OBJECT := $(BUILD_DIR)/raster.o
VM_OBJECT := $(BUILD_DIR)/vm_z8lua.o
CORE_LIBRARY := $(BUILD_DIR)/libp8core.a
TEST_BINARY := $(BUILD_DIR)/core_tests

.PHONY: all test clean

all: $(CORE_LIBRARY)

test: $(TEST_BINARY)
	$(TEST_BINARY)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(CORE_OBJECT): src/core.cpp include/p8/core.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(RASTER_OBJECT): src/raster.cpp include/p8/raster.h include/p8/core.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(VM_OBJECT): src/vm_z8lua.cpp include/p8/vm.h include/p8/core.h $(Z8_LIB) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -I$(Z8_DIR) -c $< -o $@

$(CORE_LIBRARY): $(CORE_OBJECT) $(RASTER_OBJECT)
	$(AR) rcs $@ $^

$(TEST_BINARY): tests/core_tests.cpp $(CORE_LIBRARY)
	$(CXX) $(CXXFLAGS) $< $(CORE_LIBRARY) -o $@

$(Z8_LIB): $(Z8_SOURCES)
	$(MAKE) -C $(Z8_DIR) CC=$(CXX) MYCFLAGS= MYLDFLAGS= MYLIBS= liblua.a

clean:
	rm -rf $(BUILD_DIR)
