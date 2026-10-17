import { SetMetadata } from '@nestjs/common';

/** Marks a route as public - the global JWT guard skips it. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
