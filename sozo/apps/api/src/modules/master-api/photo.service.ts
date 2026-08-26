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
    params: {
      stage: string;
      dataUrl?: string;
      /**
       * Тот же снимок под именем, которым его шлёт экран наряда-допуска.
       *
       * `permit_screen.dart:330` отправляет `{stage, data}`, а сервис читал
       * только `dataUrl` — регулярное выражение не совпадало, и каждая
       * попытка вернуть фото вскрытия давала `IMAGE_REQUIRED`. Тот же payload
       * уходил в офлайн-очередь и падал там же, блокируя всю цепочку по
       * заявке. Принимаем оба имени: ломать приложение ради красоты ключа —
       * плохая сделка.
       */
      data?: string;
      note?: string;
      geo?: { lat: number; lng: number } | null;
      clientOpUuid?: string;
      masterName: string;
    },
  ): Promise<{ id: string; duplicate: boolean; count: number; geoMissing: boolean; stage: PhotoStage }> {
    const stage = params.stage as PhotoStage;
    if (!STAGES.includes(stage)) {
      throw new BadRequestException({ code: 'STAGE_INVALID', message: 'Стадия: before | during | after | receipt' });
    }
    // Идемпотентность офлайн-очереди: повторная отправка снимка не плодит дубли
    const existing = params.clientOpUuid ? order.photos.find((p) => p.id === params.clientOpUuid) : undefined;
    if (existing) {
      return { id: existing.id!, duplicate: true, count: order.photos.filter((p) => p.stage === stage).length, geoMissing: false, stage };
    }
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(params.dataUrl ?? params.data ?? '');
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
    const id = params.clientOpUuid ?? uuidv7();
    order.photos.push({
      id,
      stage,
      source: `камера мастера ${params.masterName}${params.note ? ` · ${params.note}` : ''}`,
      file,
      geoMissing: !params.geo, // подвал, паркинг, отключённая геолокация — флаг, не блокер
      at: new Date().toISOString(),
    });
    this.orders.touchOrder();
    // `id` возвращается наружу: приложение читает его из ответа, чтобы
    // сослаться на снимок в переходе наряда, а эндпоинт такого поля не
    // отдавал вовсе — и ссылаться было не на что
    return { id, duplicate: false, count: order.photos.filter((p) => p.stage === stage).length, geoMissing: !params.geo, stage };
  }
}
