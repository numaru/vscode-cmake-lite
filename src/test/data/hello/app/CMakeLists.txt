project(Application)

add_executable(Application
    src/main.c
)

target_link_libraries(Application
    PRIVATE
        Hello::Hello
)
