#ifndef BUILDPLAY_RUNTIME_H
#define BUILDPLAY_RUNTIME_H
#ifdef __cplusplus
extern "C" {
#endif
// Caller owns the returned string and must release it with bp_runtime_free.
char *bp_runtime_evaluate(const char *source, int *failed);
void bp_runtime_free(char *result);
#ifdef __cplusplus
}
#endif
#endif
