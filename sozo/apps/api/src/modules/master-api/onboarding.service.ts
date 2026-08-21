import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { tr } from '../../common/locale';

/**
 * Онбординг мастера (PRD-02 §2, экраны M-02…M-05, ТЗ 17.1).
 *
 * Порядок жёсткий: анкета → документы → собеседование → обучение → экзамен → активация.
 * Обучение открывается сразу после анкеты (ТЗ 17.17 п.9) — кандидат учится, пока идёт
 * проверка, иначе воронка простаивает неделю. Экзамен — только после собеседования
 * и только онлайн: офлайн-экзамен нельзя защитить от списывания.
 */

export const ONBOARDING_STAGES = [
  { code: 'application', title: 'Анкета' },
  { code: 'documents', title: 'Документы' },
  { code: 'interview', title: 'Собеседование' },
  { code: 'training', title: 'Обучение' },
  { code: 'exam', title: 'Экзамен' },
  { code: 'activation', title: 'Активация' },
] as const;

/** Учебные модули: доступны с момента подачи анкеты, читаются офлайн */
export const TRAINING_MODULES = [
  {
    id: 'photo',
    title: 'Фотофиксация',
    minutes: 10,
    summary:
      'Фото «до» и «после» — единственное доказательство в споре. Снимайте узел целиком и с того же ракурса, что «до». Без фото «до» статус «В работе» не откроется.',
  },
  {
    id: 'client',
    title: 'Общение с клиентом',
    minutes: 12,
    summary:
      'Называйте цену до начала работ, а не после. Если вскрылась доп-работа — фото и два варианта, решение за клиентом. Работа по несогласованной смете не оплачивается.',
  },
  {
    id: 'standards',
    title: 'Стандарты сервиса',
    minutes: 8,
    summary: 'Бахилы, коврик под инструмент, уборка после себя. Демонтированную деталь оставляйте клиенту — это снимает половину споров.',
  },
  {
    id: 'pipeline',
    title: 'Тренажёр конвейера',
    minutes: 15,
    summary:
      'Пройдите учебную заявку целиком: выезд → фото «до» → смета → материалы с чеками → фото «после» → приёмка → оплата. Каждый шаг открывается только после предыдущего.',
  },
] as const;

/** Мини-экзамен: 12 вопросов, проходной балл 9 */
export const EXAM_QUESTIONS = [
  { id: 'q1', topic: 'photo', text: 'Сколько минимум фото «до» нужно, чтобы начать работу?', options: ['Ни одного', 'Одно', 'Три', 'Пять'], correct: 1 },
  { id: 'q2', topic: 'photo', text: 'Геолокация не определилась в подвале. Что происходит?', options: ['Работа блокируется', 'Фото не сохранится', 'Ставится флаг «без гео», работа продолжается', 'Нужно выйти на улицу и переснять'], correct: 2 },
  { id: 'q3', topic: 'client', text: 'Клиент стоит рядом и согласен на доп-работу устно. Ваши действия?', options: ['Делаю, раз согласен', 'Отправляю фото и варианты ему в приложение', 'Звоню диспетчеру', 'Записываю в блокнот'], correct: 1 },
  { id: 'q4', topic: 'client', text: 'Вы поставили запчасть без чека. Что будет?', options: ['Ничего', 'Заявку нельзя будет завершить', 'Штраф', 'Чек можно донести потом'], correct: 1 },
  { id: 'q5', topic: 'client', text: 'Клиент отказался от вынужденных работ. Что делаете?', options: ['Ухожу', 'Делаю всё равно', 'Выполняю консервацию и снимаю её на фото', 'Жду диспетчера'], correct: 2 },
  { id: 'q6', topic: 'standards', text: 'Куда девается демонтированная деталь?', options: ['Забираю себе', 'Выбрасываю', 'Оставляю клиенту', 'Сдаю на склад'], correct: 2 },
  { id: 'q7', topic: 'standards', text: 'Что берёте на каждый выезд?', options: ['Только инструмент', 'Бахилы и коврик под инструмент', 'Ничего особенного', 'Форму по желанию'], correct: 1 },
  { id: 'q8', topic: 'pipeline', text: 'Оффер висит 60 секунд, вы не ответили. Что происходит?', options: ['Заявка закрепляется за вами', 'Считается отказом, заявка уходит другому', 'Придёт повторно', 'Ничего'], correct: 1 },
  { id: 'q9', topic: 'pipeline', text: 'Сеть пропала посреди работы. Что делать?', options: ['Прекратить работу', 'Продолжать — всё уйдёт очередью при появлении сети', 'Звонить диспетчеру после каждого шага', 'Записывать на бумаге'], correct: 1 },
  { id: 'q10', topic: 'pipeline', text: 'Клиент получил наличные деньги от вас… то есть вы получили наличные. Что с ними?', options: ['Это мой доход', 'Это долг перед компанией, сдаётся в кассу', 'Половина моя', 'Ничего не меняется'], correct: 1 },
  { id: 'q11', topic: 'client', text: 'Ситуация на объекте кажется опасной. Ваши действия?', options: ['Терплю и доделываю', 'Ухожу, санкций за прерывание нет', 'Ухожу, но получу штраф', 'Звоню клиенту'], correct: 1 },
  { id: 'q12', topic: 'pipeline', text: 'Что такое «Рекомендовать»?', options: ['Обязательная доп-работа', 'Апсейл: клиент решает сам, конвейер не блокируется', 'Жалоба на клиента', 'Заявка коллеге'], correct: 1 },
] as const;

export const EXAM_PASS_SCORE = 9;
export const EXAM_MAX_ATTEMPTS = 3;

export interface ApplicationRec {
  id: string;
  phone: string;
  masterId?: string;
  fullName: string;
  experienceYears: number;
  about?: string;
  skillTags: string[];
  zones: string[];
  transport: 'own_car' | 'public';
  taxMode: 'self_employed' | 'gph';
  referralCode?: string;
  facePhoto?: string;
  /**
   * `code` — то, чем документ опознаётся, `name` — то, что читает кандидат.
   *
   * Разделены не для красоты: название уходит в приложение переведённым, и
   * если бы им же документ и опознавался, узбекский кандидат не смог бы
   * загрузить паспорт — сервер не нашёл бы «Pasport: yoyma va propiska»
   * в своём русском списке.
   */
  documents: Array<{
    code: string;
    name: string;
    status: 'missing' | 'uploaded' | 'verified' | 'rejected';
    file?: string;
    comment?: string;
  }>;
  toolChecklist: Array<{ skill: string; items: string[]; confirmed: boolean; photo?: string }>;
  stage: (typeof ONBOARDING_STAGES)[number]['code'];
  interviewAt?: string;
  rejectionReason?: string;
  trainingDone: string[];
  examAttempts: Array<{ score: number; passedAt?: string; at: string; wrongTopics: string[] }>;
  createdAt: string;
  updatedAt: string;
}

/** Наборы инструмента по навыку — без полного набора навык не активируется (ТЗ 17.1) */
export const TOOL_CHECKLIST: Record<string, string[]> = {
  сантехника: ['Разводной ключ', 'Труборез', 'Набор прокладок', 'Пресс-клещи'],
  электрика: ['Индикатор напряжения', 'Мультиметр', 'Кримпер', 'Изолента и клеммы'],
  кондиционеры: ['Манометрический коллектор', 'Вакуумный насос', 'Течеискатель'],
  сварка: ['Сварочный аппарат', 'Маска', 'Электроды'],
  малярка: ['Валики и кисти', 'Шпатели', 'Укрывной материал'],
  слаботочка: ['Обжимной инструмент', 'Тестер линий', 'Отвёртки прецизионные'],
};

export const SKILL_OPTIONS = Object.keys(TOOL_CHECKLIST);

@Injectable()
export class OnboardingService implements OnModuleInit {
  readonly applications: ApplicationRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'onboarding',
      () => this.applications,
      (d) => {
        this.applications.length = 0;
        this.applications.push(...((d ?? []) as ApplicationRec[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'Onboarding', {
      load: async (tx) => {
        const rows = await tx.masterApplication.findMany({
          include: { documents: true, toolChecks: true, examAttempts: { orderBy: { at: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        });
        if (!rows.length) return 0;
        this.applications.length = 0;
        this.applications.push(
          ...rows.map((a) => ({
            id: a.id,
            phone: a.phone,
            masterId: a.masterId ?? undefined,
            fullName: a.fullName,
            experienceYears: a.experienceYears,
            about: a.about ?? undefined,
            skillTags: a.skillTags,
            zones: a.zones,
            transport: a.transport as ApplicationRec['transport'],
            taxMode: a.taxMode as ApplicationRec['taxMode'],
            referralCode: a.referralCode ?? undefined,
            facePhoto: a.facePhoto ?? undefined,
            documents: a.documents.map((d) => ({
              code: d.code, name: d.name,
              status: d.status as ApplicationRec['documents'][number]['status'],
              file: d.file ?? undefined, comment: d.comment ?? undefined,
            })),
            toolChecklist: a.toolChecks.map((t) => ({
              skill: t.skill, items: t.items, confirmed: t.confirmed, photo: t.photo ?? undefined,
            })),
            stage: a.stage as ApplicationRec['stage'],
            interviewAt: a.interviewAt?.toISOString(),
            rejectionReason: a.rejectionReason ?? undefined,
            trainingDone: a.trainingDone,
            examAttempts: a.examAttempts.map((e) => ({
              score: e.score, passedAt: e.passedAt?.toISOString(),
              at: e.at.toISOString(), wrongTopics: e.wrongTopics,
            })),
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const a of [...this.applications]) {
          const data = {
            phone: a.phone,
            masterId: a.masterId ?? null,
            fullName: a.fullName,
            experienceYears: Math.min(60, Math.max(0, a.experienceYears)),
            about: a.about ?? null,
            skillTags: a.skillTags,
            zones: a.zones,
            transport: a.transport,
            taxMode: a.taxMode,
            referralCode: a.referralCode ?? null,
            facePhoto: a.facePhoto ?? null,
            stage: a.stage,
            interviewAt: a.interviewAt ? new Date(a.interviewAt) : null,
            // CHECK в m26 требует объяснения у отклонённой анкеты. Стадии
            // «rejected» в перечне нет — отказ здесь выражается заполненной
            // причиной на любой стадии, поэтому пустую строку не пишем: она
            // выглядит как объяснение, не будучи им
            rejectionReason: a.rejectionReason?.trim() ? a.rejectionReason : null,
            trainingDone: a.trainingDone,
          };
          await tx.masterApplication.upsert({
            where: { id: a.id },
            create: { id: a.id, tenantId, createdAt: new Date(a.createdAt), ...data },
            update: data,
          });
          for (const d of a.documents) {
            const dd = { name: d.name, status: d.status, file: d.file ?? null, comment: d.comment ?? null };
            await tx.masterApplicationDocument.upsert({
              where: { applicationId_code: { applicationId: a.id, code: d.code } },
              create: { id: uuidv7(), tenantId, applicationId: a.id, code: d.code, ...dd },
              update: dd,
            });
          }
          for (const t of a.toolChecklist) {
            const td = { items: t.items, confirmed: t.confirmed, photo: t.photo ?? null };
            await tx.masterApplicationToolCheck.upsert({
              where: { applicationId_skill: { applicationId: a.id, skill: t.skill } },
              create: { id: uuidv7(), tenantId, applicationId: a.id, skill: t.skill, ...td },
              update: td,
            });
          }
          // Попытки экзамена переписываются целиком: у них нет своего
          // идентификатора в коде, а порядок и состав значимы — по ним правят
          // обучение
          await tx.masterApplicationExam.deleteMany({ where: { applicationId: a.id } });
          for (const e of a.examAttempts) {
            await tx.masterApplicationExam.create({
              data: {
                id: uuidv7(), tenantId, applicationId: a.id,
                score: Math.min(100, Math.max(0, e.score)),
                wrongTopics: e.wrongTopics,
                passedAt: e.passedAt ? new Date(e.passedAt) : null,
                at: new Date(e.at),
              },
            });
          }
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  byPhone(phone: string): ApplicationRec | undefined {
    return this.applications.find((a) => a.phone === phone);
  }

  /** Анкета: повторная подача перезаписывает черновик, пока не ушла на проверку */
  submitApplication(phone: string, data: Omit<ApplicationRec, 'id' | 'phone' | 'stage' | 'documents' | 'toolChecklist' | 'trainingDone' | 'examAttempts' | 'createdAt' | 'updatedAt'>): ApplicationRec {
    if (!data.fullName?.trim()) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Укажите ФИО' });
    if (!data.skillTags?.length) {
      throw new BadRequestException({ code: 'SKILLS_REQUIRED', message: 'Отметьте хотя бы один навык — заявки приходят только по вашим тегам' });
    }
    const unknown = data.skillTags.filter((s) => !SKILL_OPTIONS.includes(s));
    if (unknown.length) throw new BadRequestException({ code: 'SKILL_UNKNOWN', message: tr('Неизвестные навыки: {0}', unknown.join(', ')) });
    if (!data.zones?.length) throw new BadRequestException({ code: 'ZONES_REQUIRED', message: 'Выберите районы, куда готовы выезжать' });

    const now = new Date().toISOString();
    const existing = this.byPhone(phone);
    const documents = [
      { code: 'passport', name: 'Паспорт: разворот и прописка', status: 'missing' as const },
      data.taxMode === 'gph'
        ? { code: 'gph_contract', name: 'Данные для договора ГПХ', status: 'missing' as const }
        : { code: 'self_employed', name: 'Справка о статусе самозанятого (Soliq)', status: 'missing' as const },
    ];
    const toolChecklist = data.skillTags.map((s) => ({ skill: s, items: TOOL_CHECKLIST[s] ?? [], confirmed: false }));

    if (existing) {
      Object.assign(existing, data, { updatedAt: now });
      // Навыки изменились — пересобираем чек-лист инструмента, сохраняя подтверждённые
      existing.toolChecklist = toolChecklist.map((t) => existing.toolChecklist.find((x) => x.skill === t.skill) ?? t);
      if (existing.stage === 'application') existing.stage = 'documents';
      this.store.persist();
      return existing;
    }
    const rec: ApplicationRec = {
      id: uuidv7(),
      phone,
      ...data,
      documents,
      toolChecklist,
      stage: 'documents',
      trainingDone: [],
      examAttempts: [],
      createdAt: now,
      updatedAt: now,
    };
    this.applications.push(rec);
    this.store.persist();
    return rec;
  }

  attachDocument(phone: string, key: string, file: string): ApplicationRec {
    const a = this.require(phone);
    // По названию — для анкет, заведённых до появления кода: у них его нет,
    // и терять уже загруженные документы из-за смены ключа незачем
    const doc = a.documents.find((d) => d.code === key) ?? a.documents.find((d) => d.name === key);
    if (!doc) throw new BadRequestException({ code: 'DOCUMENT_UNKNOWN', message: tr('Документ «{0}» в списке не значится', key) });
    doc.status = 'uploaded';
    doc.file = file;
    doc.comment = undefined;
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return a;
  }

  confirmTools(phone: string, skill: string, photo?: string): ApplicationRec {
    const a = this.require(phone);
    const t = a.toolChecklist.find((x) => x.skill === skill);
    if (!t) throw new BadRequestException({ code: 'SKILL_UNKNOWN' });
    t.confirmed = true;
    t.photo = photo;
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return a;
  }

  /** На проверку уходит только полный комплект: иначе воронка забивается недоделками */
  submitForReview(phone: string): ApplicationRec {
    const a = this.require(phone);
    const missingDocs = a.documents.filter((d) => d.status === 'missing' || d.status === 'rejected');
    if (missingDocs.length) {
      throw new BadRequestException({
        code: 'DOCUMENTS_INCOMPLETE',
        message: tr('Не хватает: {0}', missingDocs.map((d) => d.name).join(', ')),
      });
    }
    const unconfirmed = a.toolChecklist.filter((t) => !t.confirmed);
    if (unconfirmed.length) {
      throw new BadRequestException({
        code: 'TOOLS_INCOMPLETE',
        message: tr('Подтвердите инструмент: {0}. Без полного набора навык не активируется', unconfirmed.map((t) => t.skill).join(', ')),
      });
    }
    a.stage = 'interview';
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return a;
  }

  completeModule(phone: string, moduleId: string): ApplicationRec {
    const a = this.require(phone);
    if (!TRAINING_MODULES.some((m) => m.id === moduleId)) throw new BadRequestException({ code: 'MODULE_UNKNOWN' });
    if (!a.trainingDone.includes(moduleId)) a.trainingDone.push(moduleId);
    if (a.trainingDone.length === TRAINING_MODULES.length && a.stage === 'training') {
      // модули пройдены — экзамен откроется, если собеседование состоялось
    }
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return a;
  }

  examAvailable(a: ApplicationRec): { available: boolean; reason?: string } {
    if (a.trainingDone.length < TRAINING_MODULES.length) {
      return { available: false, reason: 'Сначала пройдите все учебные модули' };
    }
    if (['application', 'documents', 'interview'].includes(a.stage)) {
      return { available: false, reason: 'Экзамен откроется после собеседования — пока изучайте модули' };
    }
    if (a.examAttempts.filter((x) => !x.passedAt).length >= EXAM_MAX_ATTEMPTS && !a.examAttempts.some((x) => x.passedAt)) {
      return { available: false, reason: 'Попытки исчерпаны — свяжитесь с диспетчером' };
    }
    return { available: true };
  }

  submitExam(phone: string, answers: Record<string, number>): { score: number; passed: boolean; wrongTopics: string[]; attemptsLeft: number } {
    const a = this.require(phone);
    const check = this.examAvailable(a);
    if (!check.available) throw new BadRequestException({ code: 'EXAM_LOCKED', message: check.reason });

    const wrong = EXAM_QUESTIONS.filter((q) => answers[q.id] !== q.correct);
    const score = EXAM_QUESTIONS.length - wrong.length;
    const passed = score >= EXAM_PASS_SCORE;
    const wrongTopics = [...new Set(wrong.map((q) => q.topic))];
    a.examAttempts.push({ score, passedAt: passed ? new Date().toISOString() : undefined, at: new Date().toISOString(), wrongTopics });
    if (passed) a.stage = 'activation';
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return {
      score,
      passed,
      wrongTopics,
      attemptsLeft: Math.max(0, EXAM_MAX_ATTEMPTS - a.examAttempts.filter((x) => !x.passedAt).length),
    };
  }

  /** Отметки администратора: собеседование, отклонение, активация */
  setStage(phone: string, stage: ApplicationRec['stage'], extra?: { interviewAt?: string; rejectionReason?: string }): ApplicationRec {
    const a = this.require(phone);
    a.stage = stage;
    if (extra?.interviewAt) a.interviewAt = extra.interviewAt;
    if (extra?.rejectionReason) a.rejectionReason = extra.rejectionReason;
    a.updatedAt = new Date().toISOString();
    this.store.persist();
    return a;
  }

  private require(phone: string): ApplicationRec {
    const a = this.byPhone(phone);
    if (!a) throw new BadRequestException({ code: 'APPLICATION_NOT_FOUND', message: 'Сначала заполните анкету' });
    return a;
  }
}
