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

const char *p8_vm_last_error(const p8_vm *vm);
int p8_vm_has_global(p8_vm *vm, const char *name);
int p8_vm_get_global_raw(p8_vm *vm, const char *name, int32_t *raw_16_16);
int p8_vm_get_global_boolean(p8_vm *vm, const char *name, int *value);
int p8_vm_get_table_length(p8_vm *vm, const char *name, size_t *length);
int p8_vm_restart_requested(const p8_vm *vm);

#ifdef __cplusplus
}
#endif

#endif
