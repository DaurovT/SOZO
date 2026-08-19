import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from '@sozo/kernel';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';

const PHOTO_DIR = resolve(process.env.PHOTO_DIR ?? 'data/photos');
const MAX_BYTES = 6 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Снимки, присланные клиентом (C-07 «Покажите проблему», C-23 жалоба).
 *
 * Отдельно от снимков мастера: в споре важно, кто снимал. Фото клиента —
 * заявленная проблема, фото мастера — фотофиксация работ; смешивать их
 * в одном источнике нельзя, поэтому здесь свой ярлык происхождения.
 */
@Injectable()
export class ClientPhotoService {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Один снимок. По умолчанию стадия `before`: клиент снимает до работ.
   * Другие стадии нужны демо-наполнению, где есть и «после».
   */
  save(order: OrderRecord, dataUrl: string, note?: string, stage: 'before' | 'during' | 'after' | 'receipt' = 'before'): void {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl ?? '');
    if (!m) throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: 'Ожидается data:image/...;base64,...' });
    const ext = MIME_EXT[m[1].toLowerCase()];
    if (!ext) throw new BadRequestException({ code: 'MIME_UNSUPPORTED', message: 'Поддерживаются JPEG, PNG, WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.byteLength > MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Приложение сжимает снимок перед отправкой' });
    }
    if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
    const file = `${uuidv7()}.${ext}`;
    writeFileSync(resolve(PHOTO_DIR, file), buf);
    order.photos.push({
      id: uuidv7(),
      stage,
      source: `фото клиента${note ? ` · ${note}` : ''}`,
      file,
      geoMissing: true, // клиент снимает где угодно, гео к снимку не привязываем
      at: new Date().toISOString(),
    });
    this.orders.touchOrder();
  }

  /** Пачка из визарда: до 5 снимков (DEV-08 C-07) */
  saveMany(order: OrderRecord, dataUrls: string[] | undefined, max = 5): number {
    const list = (dataUrls ?? []).slice(0, max);
    for (const url of list) this.save(order, url);
    return list.length;
  }
}
