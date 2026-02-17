use std::convert::TryInto;

use anchor_lang::prelude::*;
use mpl_core::types::Key as MplCoreKey;

use crate::constants::MPL_CORE_ID;
use crate::errors::AgentsHausError;

const BASE_ASSET_OWNER_OFFSET: usize = 1;
const BASE_ASSET_MIN_LEN: usize = BASE_ASSET_OWNER_OFFSET + 32;

/// Validates that `soul_asset` is a valid mpl-core AssetV1 account bound to this
/// agent and currently owned by `expected_owner`.
pub fn assert_current_soul_owner(
    soul_asset: &AccountInfo,
    expected_soul_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        soul_asset.key(),
        *expected_soul_mint,
        AgentsHausError::SoulMintMismatch
    );
    require_keys_eq!(
        *soul_asset.owner,
        MPL_CORE_ID,
        AgentsHausError::InvalidSoulAsset
    );

    let data = soul_asset
        .try_borrow_data()
        .map_err(|_| error!(AgentsHausError::InvalidSoulAsset))?;
    require!(
        data.len() >= BASE_ASSET_MIN_LEN,
        AgentsHausError::InvalidSoulAsset
    );
    require!(
        data[0] == MplCoreKey::AssetV1 as u8,
        AgentsHausError::InvalidSoulAsset
    );

    let owner_bytes: [u8; 32] = data[BASE_ASSET_OWNER_OFFSET..BASE_ASSET_MIN_LEN]
        .try_into()
        .map_err(|_| error!(AgentsHausError::InvalidSoulAsset))?;
    let current_owner = Pubkey::new_from_array(owner_bytes);

    require_keys_eq!(
        current_owner,
        *expected_owner,
        AgentsHausError::Unauthorized
    );

    Ok(())
}
