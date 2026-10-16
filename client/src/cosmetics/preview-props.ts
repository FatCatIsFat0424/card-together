import type { AccountProfile } from '@shared/types';

/** The shopper's identity, so previews show products on their own avatar and name. */
export type PreviewAccount = Pick<AccountProfile, 'avatar' | 'avatarImage' | 'color' | 'nickname'>
  & Partial<Pick<AccountProfile, 'avatarBorder'>>;
