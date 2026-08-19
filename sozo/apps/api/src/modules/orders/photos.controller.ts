import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OrdersService } from './orders.service';
import { AuditService } from '../platform/audit.service';
import { verifyJwt, type JwtClaims } from '../../common/jwt';

const PHOTO_DIR = resolve(process.env.PHOTO_DIR ?? 'data/photos');
const MAX_BYTES = 6 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Фото-пайплайн (PRD-05 §9). Dev-реализация: dataURL → файл на диске, доступ по токену.
 * Прод: камера-only в приложении мастера, сжатие ~1600px/500КБ, EXIF-очистка,
 * серверный таймштамп, S3 + signed URL с коротким TTL, вечное хранение закрытых заявок.
 */
@Controller()
export class PhotosController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /** Загрузка фото к заявке (диспетчер прикладывает присланное мастером) */
  @Post('dispatch/orders/:id/photos')
  @UseGuards(AuthGuard)
  @Roles('dispatcher', 'admin')
  async upload(
    @Param('id') id: string,
    @Body() body: { stage?: string; dataUrl?: string; note?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const stage = body?.stage ?? 'before';
    if (!['before', 'during', 'after', 'receipt'].includes(stage)) {
      throw new BadRequestException({ code: 'STAGE_INVALID', message: 'Стадия: before | during | after | receipt' });
    }
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(body?.dataUrl ?? '');
    if (!m) throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: 'Ожидается изображение в формате data:image/...;base64,...' });
    const ext = MIME_EXT[m[1].toLowerCase()];
    if (!ext) throw new BadRequestException({ code: 'MIME_UNSUPPORTED', message: 'Поддерживаются JPEG, PNG, WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.byteLength > MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Файл больше 6 МБ; приложение мастера сжимает до ~500 КБ (PRD-05 §9)' });
    }

    const order = await this.orders.get('t0', id);
    mkdirSync(PHOTO_DIR, { recursive: true });
    const file = `${uuidv7()}.${ext}`;
    writeFileSync(resolve(PHOTO_DIR, file), buf);

    // серверный таймштамп — источник истины для споров (ТЗ 7.2)
    const photo = {
      id: uuidv7(),
      stage: stage as 'before' | 'during' | 'after' | 'receipt',
      source: `загружено диспетчером ${req.auth.phone}${body?.note ? ` · ${body.note}` : ''}`,
      file,
      geoMissing: true, // веб-загрузка без гео — флаг, не блокер (ТЗ 7.2)
      at: new Date().toISOString(),
    };
    order.photos.push(photo);
    this.orders.touchOrder();
    this.audit.write({ actorPhone: req.auth.phone, action: 'order.photo_uploaded', entity: 'Order', entityId: id, payload: { stage, file } });
    return photo;
  }

  /** Отдача файла: только по валидному токену (аналог signed URL) */
  @Get('photos/:file')
  @Header('Cache-Control', 'private, max-age=3600')
  serve(@Param('file') file: string, @Query('token') token: string | undefined, @Res() res: Response) {
    if (!token || !verifyJwt(token)) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(file)) throw new BadRequestException({ code: 'FILE_NAME_INVALID' });
    const path = resolve(PHOTO_DIR, file);
    if (!path.startsWith(PHOTO_DIR) || !existsSync(path)) throw new NotFoundException({ code: 'PHOTO_NOT_FOUND' });
    const ext = file.split('.').pop()!.toLowerCase();
    res.type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
    res.send(readFileSync(path));
  }
}
