# Nacre shell integration for bash. Started with --rcfile, so emulate a login shell first.
if [[ -z "$_NACRE_LOGIN_DONE" ]]; then
  _NACRE_LOGIN_DONE=1
  [[ -f /etc/profile ]] && source /etc/profile
  for _f in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [[ -f "$_f" ]]; then source "$_f"; break; fi
  done
  unset _f
fi
[[ $- == *i* ]] || return
[[ -n "$_NACRE_INTEGRATED" ]] && return
_NACRE_INTEGRATED=1
_nacre_running=
_nacre_in_prompt=

_nacre_osc7() {
  local url="${PWD//%/%25}"; url="${url// /%20}"
  printf '\e]7;file://%s%s\a' "${HOSTNAME}" "$url"
}

_nacre_prompt() {
  local ret=$?
  [[ -n $_nacre_running ]] && printf '\e]133;D;%s\a' "$ret"
  _nacre_running=
  _nacre_osc7
  printf '\e]133;A\a'
  _nacre_in_prompt=1
  return $ret
}

_nacre_preexec() {
  [[ -n $_nacre_in_prompt ]] || return
  [[ $BASH_COMMAND == _nacre_prompt* ]] && return
  _nacre_in_prompt=
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^ *[0-9]* *//')
  cmd="${cmd//$'\n'/\\n}"
  printf '\e]133;E;%s\a\e]133;C\a' "$cmd"
  _nacre_running=1
}

[[ $PS1 == *$'\e]133;B\a'* ]] || PS1="$PS1"'\[\e]133;B\a\]'
PROMPT_COMMAND="_nacre_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '_nacre_preexec' DEBUG
