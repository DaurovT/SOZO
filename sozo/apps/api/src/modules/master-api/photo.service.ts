import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from '@sozo/kernel';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';

const PHOTO_DIR = resolve(process.env.PHOTO_DIR ?? 'data/photos');
const MAX_BYTES = 6 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const STAGES = ['before', 'during', 'after', 'receipt'] as const;

export type PhotoStage = (typeof STAGES)[number];

/**
 * Приём снимков с камеры мастера (PRD-05 §9). Общий для всех веток конвейера:
 * фото «до», «после», чеки, закрытая дверь, шильдик, консервация — один путь,
 * один формат хранения, один серверный таймштамп как источник истины в спорах.
 */
@Injectable()
export class MasterPhotoService {
  constructor(private readonly orders: OrdersService) {}

  async save(
    order: OrderRecord,
    params: { stage: string; dataUrl?: string; note?: string; geo?: { lat: number; lng: number } | null; clientOpUuid?: string; masterName: string },
  ): Promise<{ duplicate: boolean; count: number; geoMissing: boolean; stage: PhotoStage }> {
    const stage = params.stage as PhotoStage;
    if (!STAGES.includes(stage)) {
      throw new BadRequestException({ code: 'STAGE_INVALID', message: 'Стадия: before | during | after | receipt' });
    }
    // Идемпотентность офлайн-очереди: повторная отправка снимка не плодит дубли
    if (params.clientOpUuid && order.photos.some((p) => p.id === params.clientOpUuid)) {
      return { duplicate: true, count: order.photos.filter((p) => p.stage === stage).length, geoMissing: false, stage };
    }
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(params.dataUrl ?? '');
    if (!m) throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: 'Ожидается data:image/...;base64,...' });
    const ext = MIME_EXT[m[1].toLowerCase()];
    if (!ext) throw new BadRequestException({ code: 'MIME_UNSUPPORTED', message: 'Поддерживаются JPEG, PNG, WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.byteLength > MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Приложение сжимает снимок до ~500 КБ перед отправкой (PRD-05 §9)' });
    }
    if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
    const file = `${uuidv7()}.${ext}`;
    writeFileSync(resolve(PHOTO_DIR, file), buf);
    order.photos.push({
      id: params.clientOpUuid ?? uuidv7(),
      stage,
      source: `камера мастера ${params.masterName}${params.note ? ` · ${params.note}` : ''}`,
      file,
      geoMissing: !params.geo, // подвал, паркинг, отключённая геолокация — флаг, не блокер
      at: new Date().toISOString(),
    });
    this.orders.touchOrder();
    return { duplicate: false, count: order.photos.filter((p) => p.stage === stage).length, geoMissing: !params.geo, stage };
  }
}
