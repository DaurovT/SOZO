import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Иконки, выгруженные из макета (node 21:5). Рисуем ровно тем файлом,
/// который отдал Figma, и ровно в тех размерах — перерисовывать нельзя:
/// у макетных иконок своя толщина штриха, системные Material её не повторяют.
class FigmaIcon extends StatelessWidget {
  const FigmaIcon(this.name, {super.key, required this.size, this.color});

  final String name;
  final double size;

  /// Цвет задан внутри SVG; переопределяем только там, где макет
  /// использует одну иконку в двух состояниях (активная вкладка таббара)
  final Color? color;

  @override
  Widget build(BuildContext context) {
    // Родитель нередко задаёт «тугие» ограничения — Container или SizedBox с
    // width/height и без alignment передаёт их ребёнку. Голый SvgPicture в этом
    // случае растягивается на весь бокс и size игнорируется: иконка 32 в круге 72
    // рисовалась во все 72 и вылезала за края. Align с factor'ами держит размер
    // ровно size и центрирует иконку, не меняя раскладку там, где всё уже верно.
    return Align(
      alignment: Alignment.center,
      widthFactor: 1,
      heightFactor: 1,
      child: SizedBox(
        width: size,
        height: size,
        child: SvgPicture.asset(
          'assets/icons/$name.svg',
          width: size,
          height: size,
          fit: BoxFit.contain,
          colorFilter: color == null ? null : ColorFilter.mode(color!, BlendMode.srcIn),
        ),
      ),
    );
  }
}
