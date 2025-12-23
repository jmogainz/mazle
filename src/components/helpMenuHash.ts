const BASE_HELP_MENU_HASH = process.env.NEXT_PUBLIC_HELP_MENU_HASH || 'dev';
const DEV_HASH = process.env.NODE_ENV === 'development' && typeof __webpack_hash__ !== 'undefined'
  ? `_${__webpack_hash__}`
  : '';

const HELP_MENU_HASH = `${BASE_HELP_MENU_HASH}${DEV_HASH}`;

export { HELP_MENU_HASH };
