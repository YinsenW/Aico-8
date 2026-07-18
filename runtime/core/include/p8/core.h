#ifndef P8_CORE_H
#define P8_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct p8_core p8_core;

enum {
    P8_RAM_SIZE = 0x10000,
    P8_ROM_SIZE = 0x8000,
    P8_CART_DATA_SIZE = 0x4300,
    P8_DIRTY_BITMAP_SIZE = P8_RAM_SIZE / 8,
    P8_MAX_PLAYERS = 8,
    P8_BUTTONS_PER_PLAYER = 6,
};

typedef void (*p8_tick_callback)(void *userdata);

typedef struct p8_core_callbacks {
    p8_tick_callback update;
    p8_tick_callback update60;
    p8_tick_callback draw;
    void *userdata;
} p8_core_callbacks;

typedef enum p8_draw_opcode {
    P8_DRAW_NONE = 0,
    P8_DRAW_CLS,
    P8_DRAW_PSET,
    P8_DRAW_LINE,
    P8_DRAW_RECT,
    P8_DRAW_RECTFILL,
    P8_DRAW_CIRC,
    P8_DRAW_CIRCFILL,
    P8_DRAW_OVAL,
    P8_DRAW_OVALFILL,
    P8_DRAW_SPR,
    P8_DRAW_SSPR,
    P8_DRAW_MAP,
    P8_DRAW_TLINE,
    P8_DRAW_PRINT,
    P8_DRAW_PAL,
    P8_DRAW_FILLP,
    P8_DRAW_CUSTOM,
    /* Appended to preserve the numeric ABI of every existing draw opcode. */
    P8_DRAW_PALT,
    P8_DRAW_CAMERA,
    P8_DRAW_CLIP,
    P8_DRAW_RRECT,
    P8_DRAW_RRECTFILL,
} p8_draw_opcode;

/* Arguments are raw PICO-8 16:16 values unless an opcode says otherwise. */
typedef struct p8_draw_command {
    uint16_t opcode;
    uint16_t flags;
    uint32_t sequence;
    uint32_t state_revision;
    uint32_t payload_offset;
    uint32_t payload_size;
    int32_t args[12];
} p8_draw_command;

p8_core *p8_core_create(void);
void p8_core_destroy(p8_core *core);

/* Loads up to 32 KiB of ROM and performs the normal ROM-to-RAM reset copy. */
int p8_core_load_rom(p8_core *core, const uint8_t *rom, size_t size);
void p8_core_reset(p8_core *core);

uint8_t p8_core_peek(const p8_core *core, uint16_t address);
uint16_t p8_core_peek16(const p8_core *core, uint16_t address);
uint32_t p8_core_peek32(const p8_core *core, uint16_t address);
void p8_core_poke(p8_core *core, uint16_t address, uint8_t value);
void p8_core_poke16(p8_core *core, uint16_t address, uint16_t value);
void p8_core_poke32(p8_core *core, uint16_t address, uint32_t value);
void p8_core_memset(p8_core *core, uint16_t destination, uint8_t value, size_t length);
void p8_core_memcpy(p8_core *core, uint16_t destination, uint16_t source, size_t length);
/* Copies from the immutable current-cart ROM into base RAM. */
int p8_core_reload(p8_core *core, uint16_t destination, uint16_t source, size_t length);

uint8_t p8_core_mget(const p8_core *core, int x, int y);
int p8_core_mset(p8_core *core, int x, int y, uint8_t value);

/* Diagnostic physical access bypasses the GFX/screen mapping registers. */
uint8_t p8_core_debug_peek_physical(const p8_core *core, uint16_t address);

void p8_core_clear_dirty(p8_core *core);
int p8_core_is_dirty(const p8_core *core, uint16_t address, size_t length);
size_t p8_core_copy_dirty_bitmap(const p8_core *core, uint8_t *destination, size_t capacity);

void p8_core_set_buttons(p8_core *core, unsigned player, uint8_t six_button_mask);
void p8_core_begin_update(p8_core *core);
uint8_t p8_core_btn_mask(const p8_core *core, unsigned player);
uint8_t p8_core_btnp_mask(const p8_core *core, unsigned player);
uint16_t p8_core_btn_combined(const p8_core *core);
uint16_t p8_core_btnp_combined(const p8_core *core);
int p8_core_btn(const p8_core *core, unsigned button, unsigned player);
int p8_core_btnp(const p8_core *core, unsigned button, unsigned player);

void p8_core_set_callbacks(p8_core *core, const p8_core_callbacks *callbacks);
void p8_core_set_update_rate(p8_core *core, unsigned updates_per_second);
unsigned p8_core_get_update_rate(const p8_core *core);
uint64_t p8_core_get_update_count(const p8_core *core);
void p8_core_set_time_origin_ticks60(p8_core *core, uint32_t ticks60);
int32_t p8_core_time_raw(const p8_core *core);
double p8_core_time(const p8_core *core);

/* Called by a 60 Hz host. Returns 1 when an update was executed. */
int p8_core_host_tick60(p8_core *core, int allow_draw);

void p8_core_begin_draw_stream(p8_core *core);
int p8_core_emit_draw(p8_core *core, const p8_draw_command *command);
int p8_core_emit_draw_payload(p8_core *core, const p8_draw_command *command,
                              const void *payload, size_t payload_size);
size_t p8_core_draw_count(const p8_core *core);
const p8_draw_command *p8_core_draw_data(const p8_core *core);
size_t p8_core_draw_payload_size(const p8_core *core);
const uint8_t *p8_core_draw_payload_data(const p8_core *core);

#ifdef __cplusplus
}
#endif

#endif
