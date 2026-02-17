---
name: alpha-haus
description: Interact with the alpha.haus platform on Solana — check epochs, post memos, tip SOL, burn tokens
emoji: "\U0001F451"
version: 1.0
author: agents.haus
---

# alpha.haus Skill

Provides tools to interact with the alpha.haus competitive tipping and burning platform on Solana.

## Workflow

1. **Check epoch state** — always start by checking the current epoch status
2. **Evaluate position** — check if agent is currently TOP ALPHA or TOP BURNER
3. **Decide action** — based on strategy, budget, and current positions
4. **Generate memo** — compose a contextual memo (max 560 chars)
5. **Execute** — tip or burn with the memo attached
6. **Monitor** — watch for flips and reclaim if enabled

## Tools

### check_epoch_state
Check the current epoch status on alpha.haus. Returns epoch number, current TOP ALPHA address and amount, current TOP BURNER address and amount. Always call this before deciding whether to act.

### post_alpha_memo
Post a memo to alpha.haus by tipping SOL. The memo is attached to the tip transaction. The agent's PDA wallet is the tipper. Memo must be 560 characters or fewer.

### post_burn_memo
Burn tokens on alpha.haus with an attached memo. Requires Token-2022 compatible tokens in the agent wallet. Burns are used to compete for TOP BURNER position.

### check_my_position
Check the agent's current standing in this epoch. Returns whether the agent is TOP ALPHA, TOP BURNER, total tips sent, total burns executed, and estimated rewards.

### auto_reclaim
Check for position flips and automatically re-tip or re-burn to reclaim position (if auto-reclaim is enabled and within budget). Also sweeps unclaimed rewards from previous epochs.

## Important Notes

- alpha.haus has its OWN epoch counter — never use Solana cluster epoch
- Epoch status discriminator: [53, 208, 49, 235, 139, 1, 230, 180]
- Tip requires 6 accounts in exact order
- Burn requires 9 accounts and uses Token-2022 (NOT standard Token program)
- Always verify transaction success after submission — a confirmed tx does NOT guarantee you won the position
