set(CMAKE_SYSTEM_NAME Generic CACHE INTERNAL "system name")
set(CMAKE_SYSTEM_PROCESSOR arm CACHE INTERNAL "processor")

set(mcu_arch cortex-m3)

set(CMAKE_C_COMPILER iccarm CACHE INTERNAL "c compiler")
set(CMAKE_CXX_COMPILER iccarm CACHE INTERNAL "cxx compiler")
set(CMAKE_ASM_COMPILER iasmarm CACHE INTERNAL "asm compiler")

set(CMAKE_C_FLAGS "--cpu=${mcu_arch}" CACHE INTERNAL "c compiler flags")
set(CMAKE_CXX_FLAGS "--cpu=${mcu_arch}" CACHE INTERNAL "cxx compiler flags")
set(CMAKE_ASM_FLAGS "--cpu=${mcu_arch}" CACHE INTERNAL "asm compiler flags")
