const HEIC_EXT_RE = /\.(heic|heif)$/i;
const JPEG_QUALITY = 0.9;

function isHeicImage(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "");
  return type.includes("heic") || type.includes("heif") || HEIC_EXT_RE.test(name);
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片转换失败"));
    }, "image/jpeg", JPEG_QUALITY);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("当前浏览器无法读取这张苹果照片，请换成 JPG/PNG 后再上传"));
    };
    image.src = url;
  });
}

async function drawFileToCanvas(file) {
  const bitmap = typeof createImageBitmap === "function"
    ? await createImageBitmap(file).catch(() => null)
    : null;
  const source = bitmap || await loadImageFromFile(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;

  if (!width || !height) throw new Error("图片尺寸读取失败");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, width, height);
  if (bitmap?.close) bitmap.close();
  return canvas;
}

export async function normalizeImageFile(file) {
  if (!isHeicImage(file)) return file;

  const canvas = await drawFileToCanvas(file);
  const blob = await canvasToJpegBlob(canvas);
  const name = String(file.name || "iphone-photo.heic").replace(HEIC_EXT_RE, ".jpg");
  return new File([blob], name.endsWith(".jpg") ? name : `${name}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}
