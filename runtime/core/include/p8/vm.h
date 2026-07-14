#ifndef P8_VM_H
#define P8_VM_H

#include "p8/core.h"

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct p8_vm p8_vm;

p8_vm *p8_vm_create(p8_core *core);
void p8_vm_destroy(p8_vm *vm);

int p8_vm_load_source(p8_vm *vm, const char *source, size_t size, const char *chunk_name);
int p8_vm_boot(p8_vm *vm, const char *source, size_t size, const char *chunk_name);
int p8_vm_call(p8_vm *vm, const char *function_name);
int p8_vm_update(p8_vm *vm);
int p8_vm_draw(p8_vm *vm);
int p8_vm_call_pending(const p8_vm *vm);
const char *p8_vm_active_function(const p8_vm *vm);
int p8_vm_frame_held(const p8_vm *vm);

const char *p8_vm_last_error(const p8_vm *vm);
/* Newline-delimited output from printh() without granting host file access. */
const char *p8_vm_diagnostic_output(const p8_vm *vm);
int p8_vm_has_global(p8_vm *vm, const char *name);
int p8_vm_get_global_raw(p8_vm *vm, const char *name, int32_t *raw_16_16);
int p8_vm_get_global_boolean(p8_vm *vm, const char *name, int *value);
size_t p8_vm_copy_global_string(p8_vm *vm, const char *name, char *destination,
                                size_t capacity);
int p8_vm_get_table_length(p8_vm *vm, const char *name, size_t *length);
int p8_vm_get_table_value_raw(p8_vm *vm, const char *name,
                              size_t one_based_index, int32_t *raw_16_16);
int p8_vm_get_table_entry_raw(p8_vm *vm, const char *name, size_t one_based_index,
                              const char *field, int32_t *raw_16_16);
int p8_vm_get_table_entry_boolean(p8_vm *vm, const char *name,
                                  size_t one_based_index, const char *field,
                                  int *value);
const char *p8_vm_menu_item_label(const p8_vm *vm, unsigned index);
uint8_t p8_vm_menu_item_filter(const p8_vm *vm, unsigned index);
int p8_vm_invoke_menu_item(p8_vm *vm, unsigned index, uint8_t buttons,
                           int *keep_open);
int p8_vm_restart_requested(const p8_vm *vm);

#ifdef __cplusplus
}
#endif

#endif
