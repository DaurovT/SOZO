import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from '@sozo/kernel';
import { verifyJwt, type JwtClaims } from '../../common/jwt';
import {
  OnboardingService,
  ONBOARDING_STAGES,
  TRAINING_MODULES,
  EXAM_QUESTIONS,
  EXAM_PASS_SCORE,
  SKILL_OPTIONS,
  TOOL_CHECKLIST,
} from './onboarding.service';
import { AuthGuard as AdminGuard, Roles } from '../identity/auth.guard';
import { MastersService } from '../masters/masters.module';
import { AuditService } from '../platform/audit.service';
import { tr } from '../../common/locale';

const PHOTO_DIR = resolve(process.env.PHOTO_DIR ?? 'data/photos');
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Онбординг доступен тому, у кого ещё нет карточки мастера.
 * Обычный MasterGuard таких не пускает — иначе кандидат не смог бы подать анкету.
 */
@Injectable()
export class OnboardingGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; auth?: JwtClaims }>();
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const claims = token ? verifyJwt(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    req.auth = claims;
    return true;
  }
}

const ZONES = [
  'Чиланзар', 'Юнусабад', 'Мирзо-Улугбек', 'Яккасарай', 'Шайхантахур',
  'Сергели', 'Учтепа', 'Алмазар', 'Бектемир', 'Мирабад', 'Яшнабад',
];

/** Онбординг мастера: M-02 анкета, M-03 документы, M-04 обучение и экзамен, M-05 статус */
@Controller('master/onboarding')
@UseGuards(OnboardingGuard)
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  private saveImage(dataUrl: string | undefined, label: string): string | undefined {
    if (!dataUrl) return undefined;
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: tr('Ожидается изображение: {0}', label) });
    const ext = MIME_EXT[m[1].toLowerCase()];
    if (!ext) throw new BadRequestException({ code: 'MIME_UNSUPPORTED' });
    if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
    const file = `${uuidv7()}.${ext}`;
    writeFileSync(resolve(PHOTO_DIR, file), Buffer.from(m[2], 'base64'));
    return file;
  }

  /** Что показать кандидату: справочники для анкеты + текущее состояние воронки */
  @Get('status')
  status(@Req() req: { auth: JwtClaims }) {
    const phone = req.auth.phone;
    const app = this.onboarding.byPhone(phone);
    const master = this.masters.list().find((m) => m.phone === phone);

    if (master && ['active', 'training'].includes(master.status)) {
      return { stage: 'activation', activated: true, masterStatus: master.status, message: 'Доступ открыт — можно выходить на линию' };
    }

    const exam = app ? this.onboarding.examAvailable(app) : { available: false, reason: 'Сначала заполните анкету' };
    return {
      activated: false,
      stages: ONBOARDING_STAGES,
      stage: app?.stage ?? 'application',
      application: app ?? null,
      skillOptions: SKILL_OPTIONS,
      toolChecklist: TOOL_CHECKLIST,
      zones: ZONES,
      modules: TRAINING_MODULES.map((m) => ({ ...m, done: app?.trainingDone.includes(m.id) ?? false })),
      exam: {
        available: exam.available,
        reason: exam.reason,
        passScore: EXAM_PASS_SCORE,
        questionCount: EXAM_QUESTIONS.length,
        attempts: app?.examAttempts ?? [],
      },
      nextStep: this.nextStep(app?.stage ?? 'application', app),
    };
  }

  private nextStep(stage: string, app: ReturnType<OnboardingService['byPhone']>): string {
    if (app?.rejectionReason) return tr('Анкета отклонена: {0}', app.rejectionReason);
    return switchStage(stage, app?.interviewAt);
  }

  @Post('application')
  application(
    @Body() b: {
      fullName?: string;
      experienceYears?: number;
      about?: string;
      skillTags?: string[];
      zones?: string[];
      transport?: 'own_car' | 'public';
      taxMode?: 'self_employed' | 'gph';
      referralCode?: string;
      facePhotoDataUrl?: string;
    },
    @Req() req: { auth: JwtClaims },
  ) {
    const face = this.saveImage(b?.facePhotoDataUrl, 'фото лица');
    const rec = this.onboarding.submitApplication(req.auth.phone, {
      fullName: b?.fullName ?? '',
      experienceYears: Number(b?.experienceYears ?? 0),
      about: b?.about,
      skillTags: b?.skillTags ?? [],
      zones: b?.zones ?? [],
      transport: b?.transport ?? 'public',
      taxMode: b?.taxMode ?? 'self_employed',
      referralCode: b?.referralCode,
      facePhoto: face,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.application_submitted', entity: 'MasterProfile', entityId: rec.id, payload: { skills: rec.skillTags } });
    return { ...rec, note: 'Учебные модули открыты сразу — начните, пока идёт проверка документов' };
  }

  @Post('documents')
  document(@Body() b: { code?: string; name?: string; dataUrl?: string }, @Req() req: { auth: JwtClaims }) {
    // `name` принимаем ради старых сборок приложения: они кода не знают
    const key = b?.code ?? b?.name;
    if (!key) throw new BadRequestException({ code: 'NAME_REQUIRED' });
    const file = this.saveImage(b?.dataUrl, key);
    if (!file) throw new BadRequestException({ code: 'IMAGE_REQUIRED', message: 'Снимите документ камерой' });
    return this.onboarding.attachDocument(req.auth.phone, key, file);
  }

  @Post('tools')
  tools(@Body() b: { skill?: string; dataUrl?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.skill) throw new BadRequestException({ code: 'SKILL_REQUIRED' });
    const photo = this.saveImage(b?.dataUrl, 'фото набора инструмента');
    return this.onboarding.confirmTools(req.auth.phone, b.skill, photo);
  }

  @Post('submit')
  submit(@Req() req: { auth: JwtClaims }) {
    const rec = this.onboarding.submitForReview(req.auth.phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.submitted_for_review', entity: 'MasterProfile', entityId: rec.id });
    return { ...rec, message: 'Отправлено на проверку — обычно 1–2 дня' };
  }

  @Get('training')
  training(@Req() req: { auth: JwtClaims }) {
    const app = this.onboarding.byPhone(req.auth.phone);
    return {
      modules: TRAINING_MODULES.map((m) => ({ ...m, done: app?.trainingDone.includes(m.id) ?? false })),
      exam: app ? this.onboarding.examAvailable(app) : { available: false, reason: 'Сначала заполните анкету' },
    };
  }

  @Post('training/complete')
  complete(@Body() b: { moduleId?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.moduleId) throw new BadRequestException({ code: 'MODULE_REQUIRED' });
    return this.onboarding.completeModule(req.auth.phone, b.moduleId);
  }

  /** Вопросы без правильных ответов — иначе экзамен решается чтением трафика */
  @Get('exam')
  exam(@Req() req: { auth: JwtClaims }) {
    const app = this.onboarding.byPhone(req.auth.phone);
    const check = app ? this.onboarding.examAvailable(app) : { available: false, reason: 'Сначала заполните анкету' };
    return {
      ...check,
      passScore: EXAM_PASS_SCORE,
      questions: check.available ? EXAM_QUESTIONS.map(({ id, topic, text, options }) => ({ id, topic, text, options })) : [],
      note: 'Экзамен доступен только при сети',
    };
  }

  @Post('exam')
  submitExam(@Body() b: { answers?: Record<string, number> }, @Req() req: { auth: JwtClaims }) {
    const r = this.onboarding.submitExam(req.auth.phone, b?.answers ?? {});
    const app = this.onboarding.byPhone(req.auth.phone)!;
    if (r.passed) {
      // Экзамен сдан — заводим карточку мастера на испытательный срок.
      // Активные заявки откроются после того, как админ переведёт в active (ТЗ 17.1).
      const existing = this.masters.list().find((m) => m.phone === app.phone);
      if (!existing) {
        const created = this.masters.create({
          fullName: app.fullName,
          phone: app.phone,
          skillTags: app.skillTags,
          taxMode: app.taxMode,
          hasVehicle: app.transport === 'own_car',
        });
        // Связка с пригласившим: код кандидат вводил в анкете, здесь он
        // превращается в постоянную связь — по ней считается бонус (ТЗ 18 п.11)
        const referrer = app.referralCode
          ? this.masters.list().find((x) => x.qrBadgeCode.toLowerCase() === app.referralCode!.trim().toLowerCase())
          : undefined;
        this.masters.update(created.id, {
          status: 'training',
          zones: app.zones,
          referrerCode: referrer?.qrBadgeCode,
          referrerName: referrer?.fullName,
        });
        app.masterId = created.id;
      }
      this.audit.write({ actorPhone: app.phone, action: 'onboarding.exam_passed', entity: 'MasterProfile', entityId: app.id, payload: { score: r.score } });
    }
    return {
      ...r,
      message: r.passed
        ? 'Экзамен сдан. Карточка создана — доступ откроет администратор после подписания договора'
        : tr('Не сдано: {0} из {1}. Разберите темы и попробуйте снова', r.score, EXAM_QUESTIONS.length),
    };
  }
}

/** A-12: воронка онбординга в админке — здесь кандидат двигается по этапам */
@Controller('admin/onboarding')
@UseGuards(AdminGuard)
@Roles('admin', 'accountant')
export class AdminOnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  funnel() {
    const all = this.onboarding.applications;
    return {
      stages: ONBOARDING_STAGES.map((s) => ({
        ...s,
        count: all.filter((a) => a.stage === s.code).length,
        candidates: all
          .filter((a) => a.stage === s.code)
          .map((a) => ({
            id: a.id,
            phone: a.phone,
            fullName: a.fullName,
            skillTags: a.skillTags,
            experienceYears: a.experienceYears,
            documentsReady: a.documents.every((d) => d.status !== 'missing' && d.status !== 'rejected'),
            toolsReady: a.toolChecklist.every((t) => t.confirmed),
            trainingDone: a.trainingDone.length,
            bestExam: Math.max(0, ...a.examAttempts.map((x) => x.score)),
            interviewAt: a.interviewAt,
            updatedAt: a.updatedAt,
          })),
      })),
      total: all.length,
    };
  }

  /**
   * Приглашение на собеседование.
   *
   * Стадия становится именно «собеседование», а не «обучение»: иначе кандидат
   * никогда не увидит сообщения «приходите такого-то числа», а экзамен
   * откроется до того, как с человеком поговорили живьём.
   */
  @Post('interview')
  interview(@Body() b: { phone?: string; at?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.phone || !b?.at) throw new BadRequestException({ code: 'PHONE_AND_DATE_REQUIRED' });
    const rec = this.onboarding.setStage(b.phone, 'interview', { interviewAt: b.at });
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.interview_scheduled', entity: 'MasterProfile', entityId: rec.id, payload: { at: b.at } });
    return rec;
  }

  /**
   * Собеседование состоялось — открываем обучение и экзамен.
   *
   * Отдельным действием от приглашения: между «позвали» и «пришёл» проходит
   * несколько дней, и половина кандидатов не доходит. Слить два шага в один
   * значило бы считать пришедшими всех приглашённых.
   */
  @Post('interview/passed')
  interviewPassed(@Body() b: { phone?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.phone) throw new BadRequestException({ code: 'PHONE_REQUIRED' });
    const app = this.onboarding.byPhone(b.phone);
    if (!app) throw new BadRequestException({ code: 'APPLICATION_NOT_FOUND' });
    if (app.stage !== 'interview') {
      throw new BadRequestException({
        code: 'INTERVIEW_NOT_SCHEDULED',
        message: 'Сначала назначьте собеседование',
      });
    }
    const rec = this.onboarding.setStage(b.phone, 'training');
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.interview_passed', entity: 'MasterProfile', entityId: rec.id, payload: {} });
    return rec;
  }

  @Post('reject')
  reject(@Body() b: { phone?: string; reason?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.phone || !b?.reason?.trim()) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина отказа обязательна — кандидат её увидит' });
    }
    const rec = this.onboarding.setStage(b.phone, 'application', { rejectionReason: b.reason });
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.rejected', entity: 'MasterProfile', entityId: rec.id, payload: { reason: b.reason } });
    return rec;
  }

  /** Активация: договор подписан, карточка переводится на линию */
  @Post('activate')
  activate(@Body() b: { phone?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b?.phone) throw new BadRequestException({ code: 'PHONE_REQUIRED' });
    const app = this.onboarding.byPhone(b.phone);
    if (!app) throw new BadRequestException({ code: 'APPLICATION_NOT_FOUND' });
    if (!app.examAttempts.some((x) => x.passedAt)) {
      throw new BadRequestException({ code: 'EXAM_NOT_PASSED', message: 'Экзамен не сдан — активация невозможна' });
    }
    const master = this.masters.list().find((m) => m.phone === b.phone);
    if (!master) throw new BadRequestException({ code: 'MASTER_NOT_FOUND' });
    this.masters.update(master.id, { status: 'active' });
    this.onboarding.setStage(b.phone, 'activation');
    this.audit.write({ actorPhone: req.auth.phone, action: 'onboarding.activated', entity: 'MasterProfile', entityId: master.id });
    return { ...master, status: 'active', message: 'Мастер на линии' };
  }
}

function switchStage(stage: string, interviewAt?: string): string {
  switch (stage) {
    case 'application':
      return 'Заполните анкету — это 5 минут';
    case 'documents':
      return 'Снимите документы и подтвердите инструмент';
    case 'interview':
      return interviewAt
        ? tr('Приходите на собеседование: {0}', interviewAt)
        : 'Ждём проверку документов — обычно 1–2 дня. Пока изучайте модули';
    case 'training':
      return 'Пройдите модули и сдайте экзамен';
    case 'exam':
      return 'Сдайте мини-экзамен';
    case 'activation':
      return 'Экзамен сдан — ждём подписание договора и активацию';
    default:
      return '';
  }
}
