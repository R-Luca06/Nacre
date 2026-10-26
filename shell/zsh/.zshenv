# Nacre: restore the user's ZDOTDIR so zsh keeps reading their own startup files,
# then load the integration once the shell is interactive.
if [[ -n "${NACRE_USER_ZDOTDIR+x}" ]]; then
  ZDOTDIR="$NACRE_USER_ZDOTDIR"
  unset NACRE_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
[[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"
if [[ -o interactive && -n "$NACRE_SHELL_DIR" ]]; then
  source "$NACRE_SHELL_DIR/nacre.zsh"
fi
