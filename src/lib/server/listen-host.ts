// Listen-Adresse des adapter-node-Servers (#879): ohne gesetztes HOST bindet
// der Server an Loopback statt an 0.0.0.0. Ein gesetzter Wert gewinnt.
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

export function applyDefaultListenHost(env: Record<string, string | undefined>): void {
	if (env.HOST === undefined || env.HOST === '') {
		env.HOST = DEFAULT_LISTEN_HOST;
	}
}
