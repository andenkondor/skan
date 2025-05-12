#!/bin/zsh

while [[ $# -gt 0 ]]; do
  case $1 in
  -s | --search-sops)
    SEARCH_SOPS=true
    shift
    break
    ;;
  --)
    MULTI_WORD=true
    shift
    break
    ;;
  *)
    break
    ;;
  esac
done

PREVIEW='if sops-opener --check-only {1}; then
          sops -d {1} | bat --style=full --color=always --highlight-line {2}
        else
          bat --style=full --color=always --highlight-line {2} {1}
        fi'

OPENER='if [[ $FZF_SELECT_COUNT -eq 0 ]]; then
          if sops-opener --check-only {1}; then
            sops {1}
          else
            nvim {1} "+call cursor({2},{3})"
          fi
        else
          nvim +copen -q {+f}
        fi'

if [[ -n $SEARCH_SOPS ]]; then
  RELOAD="reload:echo {q} | xargs rg --pre sops-opener --column --color=always --smart-case || :"
else
  RELOAD='reload:echo {q} | xargs rg --column --color=always --smart-case || :'
fi

if [[ -n $MULTI_WORD ]]; then
  QUERY="'$*'"
else
  QUERY="$*"
fi

fzf --disabled --ansi --multi \
  --bind "start:$RELOAD" --bind "change:$RELOAD" \
  --bind "enter:become:$OPENER" \
  --bind "ctrl-o:execute:$OPENER" \
  --bind 'alt-a:select-all,alt-d:deselect-all,ctrl-/:toggle-preview' \
  --delimiter : \
  --preview "$PREVIEW" \
  --preview-window '~4,+{2}+4/3,<80(up)' \
  --query "$QUERY"
