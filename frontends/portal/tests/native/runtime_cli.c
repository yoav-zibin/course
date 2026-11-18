#include <stdio.h>
#include <stdlib.h>
#include "buildplay_runtime.h"

int main(void) {
  char *source = calloc(1500002, 1);
  if (!source) return 2;
  size_t length = fread(source, 1, 1500001, stdin);
  if (length > 1500000) { free(source); return 3; }
  int failed = 0;
  char *result = bp_runtime_evaluate(source, &failed);
  free(source);
  if (!result) return 4;
  printf("%d\n%s", failed, result);
  bp_runtime_free(result);
  return 0;
}
