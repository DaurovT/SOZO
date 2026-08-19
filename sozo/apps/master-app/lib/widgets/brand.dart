import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../design_tokens.dart';

/// Фирменный знак и логотип. Единственное место, где приложение рисует бренд —
/// чтобы при смене логотипа не искать его по экранам.
class SozoMark extends StatelessWidget {
  const SozoMark({super.key, this.size = 56});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset('assets/logo/mark.svg', width: size, height: size);
  }
}

class SozoWordmark extends StatelessWidget {
  const SozoWordmark({super.key, this.height = 28});

  final double height;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset('assets/logo/wordmark.svg', height: height);
  }
}

/// Аватар мастера: инициал на мягкой янтарной подложке.
/// Фото профиля появится, когда его начнут проверять на модерации.
class MasterAvatar extends StatelessWidget {
  const MasterAvatar({super.key, required this.name, this.size = 48, this.online});

  final String name;
  final double size;
  final bool? online;

  @override
  Widget build(BuildContext context) {
    final letter = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(color: SozoColors.accent.withValues(alpha: 0.18), shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(
              letter,
              style: TextStyle(fontSize: size * 0.42, fontWeight: FontWeight.w700, color: SozoColors.text),
            ),
          ),
          if (online != null)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: size * 0.28,
                height: size * 0.28,
                decoration: BoxDecoration(
                  color: online! ? SozoColors.success : SozoColors.textTertiary,
                  shape: BoxShape.circle,
                  border: Border.all(color: SozoColors.bg, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
