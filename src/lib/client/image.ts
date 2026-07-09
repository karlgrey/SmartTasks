/** Downscale to maxEdge px (longest side) and re-encode as JPEG q0.8.
 *  Side effect by design: strips EXIF (incl. GPS). */
export async function downscaleImage(file: File, maxEdge = 1600): Promise<Blob> {
	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error(`${file.name}: not a supported image`);
	});
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
	if (!blob) throw new Error('image conversion failed');
	return blob;
}
