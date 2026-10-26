# Nacre shell integration for zsh: OSC 7 (cwd) and OSC 133 (prompt/command marks).
[[ -o interactive ]] || return
(( ${+_NACRE_INTEGRATED} )) && return
typeset -g _NACRE_INTEGRATED=1 _nacre_running=

# First precmd hook: report the finished command, keep $? for the hooks after it.
_nacre_status() {
  local ret=$?
  [[ -n $_nacre_running ]] && printf '\e]133;D;%s\a' "$ret"
  _nacre_running=
  return $ret
}

# Last precmd hook: runs after prompt themes have rebuilt PS1.
_nacre_prompt() {
  local url="${PWD//\%/%25}"; url="${url// /%20}"
  printf '\e]7;file://%s%s\a' "${HOST}" "$url"
  [[ $PS1 == *$'\e]133;B\a'* ]] || PS1="$PS1%{"$'\e]133;B\a'"%}"
  printf '\e]133;A\a'
  precmd_functions=(_nacre_status ${precmd_functions:#_nacre_(status|prompt)} _nacre_prompt)
}

_nacre_preexec() {
  local cmd="${1//$'\n'/\\n}"; cmd="${cmd//$'\a'/}"; cmd="${cmd//$'\e'/}"
  printf '\e]133;E;%s\a\e]133;C\a' "$cmd"
  _nacre_running=1
}

precmd_functions=(_nacre_status ${precmd_functions} _nacre_prompt)
preexec_functions+=(_nacre_preexec)
