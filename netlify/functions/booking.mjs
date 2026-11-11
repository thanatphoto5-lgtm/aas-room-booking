import {getStore} from '@netlify/blobs';
import {createHandler} from '../../server/handler.mjs';
export default createHandler(() => getStore({name: 'aas-booking-v3', consistency: 'strong'}));
