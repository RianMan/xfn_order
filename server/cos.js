import COS from "cos-nodejs-sdk-v5";
import crypto from "node:crypto";
import path from "node:path";
import "./env.js";

let cosClient = null;

const BUCKET = process.env.COS_BUCKET || "juanjuanquan-1259279217";
const REGION = process.env.COS_REGION || "ap-guangzhou";

function getCos() {
  if (!cosClient) {
    cosClient = new COS({
      SecretId: process.env.SecretId,
      SecretKey: process.env.SecretKey
    });
  }
  return cosClient;
}

function publicUrl(key) {
  return `https://${BUCKET}.cos.${REGION}.myqcloud.com/${key}`;
}

function dateKey() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

export async function uploadBuffer(buffer, originalName, folder = "after-sales/screenshots") {
  const ext = path.extname(originalName) || ".jpg";
  const key = `${folder}/${dateKey()}/${crypto.randomBytes(8).toString("hex")}${ext}`;

  if (!process.env.SecretId || !process.env.SecretKey) {
    throw new Error("缺少 COS 配置：SecretId / SecretKey");
  }

  await new Promise((resolve, reject) => {
    getCos().putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length
      },
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  return publicUrl(key);
}
