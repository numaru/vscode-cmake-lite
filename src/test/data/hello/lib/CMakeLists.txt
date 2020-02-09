project(Hello)
set(CMAKE_C_STANDARD 90)

add_library(Hello
    src/hello.c
)

target_include_directories(Hello
    PUBLIC
        inc
)

target_compile_definitions(Hello
    PUBLIC
        PUBLIC_DEFINE
    PRIVATE
        PRIVATE_DEFINE=1
)

add_library(Hello::Hello ALIAS Hello)
