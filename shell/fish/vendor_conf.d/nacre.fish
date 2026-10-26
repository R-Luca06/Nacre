# Nacre shell integration for fish (loaded through XDG_DATA_DIRS).
status is-interactive; or exit
set -q _NACRE_INTEGRATED; and exit
set -g _NACRE_INTEGRATED 1

function __nacre_osc7 --on-variable PWD
    printf '\e]7;file://%s%s\a' (hostname) (string escape --style=url -- $PWD)
end

function __nacre_prompt --on-event fish_prompt
    if set -q __nacre_running
        printf '\e]133;D;%s\a' $__nacre_status
        set -e __nacre_running
    end
    __nacre_osc7
    printf '\e]133;A\a'
end

function __nacre_preexec --on-event fish_preexec
    set -l cmd (string replace -a \n '\\n' -- $argv[1])
    printf '\e]133;E;%s\a\e]133;C\a' $cmd
    set -g __nacre_running 1
end

function __nacre_postexec --on-event fish_postexec
    set -g __nacre_status $status
end

functions -q fish_prompt; and functions -c fish_prompt __nacre_user_prompt
function fish_prompt
    __nacre_user_prompt
    printf '\e]133;B\a'
end
