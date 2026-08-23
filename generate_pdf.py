import sys
sys.path.insert(0, '/Users/carolinaurzua/Library/Python/3.9/lib/python/site-packages')
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.pdfgen import canvas

pdf_filename = "/Users/carolinaurzua/.gemini/antigravity/scratch/xuexi-web/Informe_Membresias_Tesoreria_Xuexi.pdf"
artifact_pdf = "/Users/carolinaurzua/.gemini/antigravity/brain/f1251919-8710-454d-9fc3-acde2c8d622e/Informe_Membresias_Tesoreria_Xuexi.pdf"

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#A09080"))
        # Header line
        self.setStrokeColor(colors.HexColor("#D4AF61"))
        self.setLineWidth(0.5)
        self.line(40, 750, 572, 750)
        self.drawString(40, 756, "XUEXI CLUB UC · INFORME DE TESORERÍA: SISTEMA DE MEMBRESÍAS Y PAGOS")
        
        # Footer line
        self.line(40, 45, 572, 45)
        page_text = f"Página {self._pageNumber} de {page_count}"
        self.drawRightString(572, 32, page_text)
        self.drawString(40, 32, "Pontificia Universidad Católica de Chile · Documento Oficial")
        self.restoreState()

doc = SimpleDocTemplate(
    pdf_filename,
    pagesize=letter,
    leftMargin=40,
    rightMargin=40,
    topMargin=54,
    bottomMargin=54
)

styles = getSampleStyleSheet()

# Estilos de Marca Xuexi
c_granate = colors.HexColor("#C0392B")
c_gold = colors.HexColor("#D4AF61")
c_ink = colors.HexColor("#1A1414")
c_cream = colors.HexColor("#F5EFE6")
c_jade = colors.HexColor("#2E7D6B")
c_dim = colors.HexColor("#554440")
c_code_bg = colors.HexColor("#221A1A")

title_style = ParagraphStyle(
    'DocTitle',
    parent=styles['Heading1'],
    fontName='Helvetica-Bold',
    fontSize=18,
    leading=22,
    textColor=c_granate,
    spaceAfter=4
)

subtitle_style = ParagraphStyle(
    'DocSubtitle',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=9.5,
    leading=13,
    textColor=c_gold,
    spaceAfter=12
)

section_heading = ParagraphStyle(
    'SectionHead',
    parent=styles['Heading2'],
    fontName='Helvetica-Bold',
    fontSize=12,
    leading=16,
    textColor=c_granate,
    spaceBefore=12,
    spaceAfter=6
)

body_style = ParagraphStyle(
    'BodyDark',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=9,
    leading=13.5,
    textColor=c_ink,
    spaceAfter=6
)

code_style = ParagraphStyle(
    'CodeStyle',
    parent=styles['Normal'],
    fontName='Courier',
    fontSize=7.5,
    leading=10.5,
    textColor=colors.HexColor("#F5C6CB"),
    backColor=c_code_bg,
    borderPadding=6,
    spaceAfter=8
)

mode_title_style = ParagraphStyle(
    'ModeTitle',
    parent=styles['Heading3'],
    fontName='Helvetica-Bold',
    fontSize=10.5,
    leading=14,
    textColor=c_ink,
    spaceAfter=3
)

story = []

# Encabezado Documento
story.append(Paragraph("<b>INFORME TÉCNICO Y VISUAL DE TESORERÍA</b>", title_style))
story.append(Paragraph("SISTEMA DE ACREDITACIÓN Y CUOTAS DE MEMBRESÍA DIFERENCIADAS (SANTIAGO vs. REGIONES)", subtitle_style))
story.append(HRFlowable(width="100%", thickness=1.5, color=c_gold, spaceBefore=0, spaceAfter=10))

# 1. Resumen Ejecutivo
story.append(Paragraph("1. Resumen Ejecutivo y Lógica de Negocio", section_heading))
exec_summary_text = (
    "Se ha implementado el módulo de cuotas mensuales para los socios del <b>Xuexi Club UC</b>. "
    "El sistema evalúa de forma dinámica dos variables por perfil de usuario: su <b>estado de pago</b> (Al día vs. Pendiente) "
    "y su <b>designación de ubicación</b> (General / Santiago RM a $2.000 CLP vs. Regiones a $1.000 CLP). "
    "Cada miembro visualiza <b>únicamente la opción que le corresponde</b>, garantizando la claridad tarifaria "
    "y evitando cobros duplicados cuando la cuota ya está al día."
)
story.append(Paragraph(exec_summary_text, body_style))

# Tabla de Tarifas
data_table = [
    [Paragraph("<b>Categoría de Membresía</b>", body_style), Paragraph("<b>Ubicación Designada</b>", body_style), Paragraph("<b>Monto Mensual</b>", body_style), Paragraph("<b>Visualización de Pago</b>", body_style)],
    [Paragraph("Cuota General", body_style), Paragraph("Santiago / Región Metropolitana", body_style), Paragraph("<b>$2.000 CLP</b>", body_style), Paragraph("1 Botón Exclusivo (Granate & Oro)", body_style)],
    [Paragraph("Cuota Regiones", body_style), Paragraph("Regiones fuera de Santiago / RM", body_style), Paragraph("<b>$1.000 CLP</b>", body_style), Paragraph("1 Botón Exclusivo (Verde Jade)", body_style)],
    [Paragraph("Cuota Al Día", body_style), Paragraph("Cualquier ubicación (al día)", body_style), Paragraph("<b>$0 (Cubierta)</b>", body_style), Paragraph("<b>Sin botones</b> (Badge Vigente)", body_style)]
]
t = Table(data_table, colWidths=[105, 145, 95, 187])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#FAF3E0")),
    ('ALIGN', (0,0), (-1,-1), 'LEFT'),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#D4AF61")),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(t)
story.append(Spacer(1, 10))

# 2. Código de Diseño y Estructura por Modo
story.append(Paragraph("2. Extracción de Código de Diseño y Comportamiento UI (Los 3 Modos)", section_heading))

# MODO 1: CUOTA CUBIERTA / AL DÍA
story.append(Paragraph("🟢 MODO 1: Cuota Cubierta / Membresía Al Día", mode_title_style))
desc_m1 = "<b>Comportamiento UI:</b> Cuando el socio tiene su cuota regularizada, los botones de pago se ocultan por completo. Se despliega una insignia verde esmeralda con sello oficial."
story.append(Paragraph(desc_m1, body_style))
code_m1 = (
    "&lt;!-- MODO 1: HTML & CSS Renderizado para Membresía Al Día --&gt;\n"
    "&lt;div class=\"payment-card-status al-dia\"&gt;\n"
    "  &lt;div class=\"pay-status-info\"&gt;\n"
    "    &lt;div class=\"pay-seal-icon\"&gt;印&lt;/div&gt; &lt;!-- Sello Hanzi Oficial --&gt;\n"
    "    &lt;div&gt;\n"
    "      &lt;span class=\"pay-status-badge badge-al-dia\"&gt;Membresía Al Día&lt;/span&gt;\n"
    "      &lt;h3 class=\"pay-status-title\"&gt;&lt;span class=\"zh\"&gt;会费&lt;/span&gt;Acreditación y Cuotas&lt;/h3&gt;\n"
    "      &lt;p class=\"pay-status-sub\"&gt;Tu cuota está al día. Próxima renovación: 5 de Septiembre.&lt;/p&gt;\n"
    "    &lt;/div&gt;\n"
    "  &lt;/div&gt;\n"
    "  &lt;div class=\"pay-actions-group\"&gt;\n"
    "    &lt;span class=\"badge-active-ok\"&gt;✓ Membresía Vigente y Activa&lt;/span&gt;\n"
    "  &lt;/div&gt;\n"
    "&lt;/div&gt;"
)
story.append(Paragraph(code_m1, code_style))

# MODO 2: SANTIAGO / RM ($2.000)
story.append(Paragraph("🔴 MODO 2: Cuota Pendiente · General / Santiago (RM) — $2.000 CLP", mode_title_style))
desc_m2 = "<b>Comportamiento UI:</b> Para miembros asignados a Santiago, se renderiza ÚNICAMENTE el botón de pago General ($2.000 CLP) en tonos Granate y Oro Imperial."
story.append(Paragraph(desc_m2, body_style))
code_m2 = (
    "&lt;!-- MODO 2: HTML & CSS Renderizado para Santiago / RM ($2.000 CLP) --&gt;\n"
    "&lt;div class=\"payment-card-status pendiente\"&gt;\n"
    "  &lt;div class=\"pay-status-info\"&gt;\n"
    "    &lt;div class=\"pay-seal-icon\"&gt;印&lt;/div&gt;\n"
    "    &lt;div&gt;\n"
    "      &lt;span class=\"pay-status-badge badge-pendiente\"&gt;Cuota Pendiente&lt;/span&gt;\n"
    "      &lt;h3 class=\"pay-status-title\"&gt;&lt;span class=\"zh\"&gt;会费&lt;/span&gt;Acreditación y Cuotas&lt;/h3&gt;\n"
    "      &lt;p class=\"pay-status-sub\"&gt;Cuota General / RM ($2.000/mes) pendiente por regularizar.&lt;/p&gt;\n"
    "    &lt;/div&gt;\n"
    "  &lt;/div&gt;\n"
    "  &lt;div class=\"pay-actions-group\"&gt;\n"
    "    &lt;a href=\"https://mpago.li/xuexi-general-2k\" class=\"pay-btn-gold\"&gt;\n"
    "      &lt;span class=\"zh\"&gt;付费&lt;/span&gt; &lt;span&gt;Pagar $2.000 CLP (General / RM)&lt;/span&gt;\n"
    "    &lt;/a&gt;\n"
    "  &lt;/div&gt;\n"
    "&lt;/div&gt;"
)
story.append(Paragraph(code_m2, code_style))

# MODO 3: REGIONES ($1.000)
story.append(Paragraph("🟢 MODO 3: Cuota Pendiente · Regiones — $1.000 CLP", mode_title_style))
desc_m3 = "<b>Comportamiento UI:</b> Para miembros asignados a Regiones, se renderiza ÚNICAMENTE el botón de pago Regiones ($1.000 CLP) en tonos Verde Jade."
story.append(Paragraph(desc_m3, body_style))
code_m3 = (
    "&lt;!-- MODO 3: HTML & CSS Renderizado para Regiones ($1.000 CLP) --&gt;\n"
    "&lt;div class=\"payment-card-status pendiente\"&gt;\n"
    "  &lt;div class=\"pay-status-info\"&gt;\n"
    "    &lt;div class=\"pay-seal-icon\"&gt;印&lt;/div&gt;\n"
    "    &lt;div&gt;\n"
    "      &lt;span class=\"pay-status-badge badge-pendiente\"&gt;Cuota Pendiente&lt;/span&gt;\n"
    "      &lt;h3 class=\"pay-status-title\"&gt;&lt;span class=\"zh\"&gt;会费&lt;/span&gt;Acreditación y Cuotas&lt;/h3&gt;\n"
    "      &lt;p class=\"pay-status-sub\"&gt;Cuota Regiones ($1.000/mes) pendiente por regularizar.&lt;/p&gt;\n"
    "    &lt;/div&gt;\n"
    "  &lt;/div&gt;\n"
    "  &lt;div class=\"pay-actions-group\"&gt;\n"
    "    &lt;a href=\"https://mpago.li/xuexi-region-1k\" class=\"pay-btn-jade\"&gt;\n"
    "      &lt;span class=\"zh\"&gt;地域&lt;/span&gt; &lt;span&gt;Pagar $1.000 CLP (Regiones)&lt;/span&gt;\n"
    "    &lt;/a&gt;\n"
    "  &lt;/div&gt;\n"
    "&lt;/div&gt;"
)
story.append(Paragraph(code_m3, code_style))

# 3. Enlaces Directos de Verificación en Vivo
story.append(Paragraph("3. Enlaces Directos de Verificación en Vivo", section_heading))
links_text = (
    "Para verificar el comportamiento interactivo en tiempo real desde la web oficial:<br/>"
    "• <b>Membresía Al Día</b>: <font color=\"#C0392B\">https://xuexiclub.cl/miembro.html?estado=al_dia</font><br/>"
    "• <b>Santiago / RM ($2.000)</b>: <font color=\"#C0392B\">https://xuexiclub.cl/miembro.html?estado=pendiente&tipo=general</font><br/>"
    "• <b>Regiones ($1.000)</b>: <font color=\"#C0392B\">https://xuexiclub.cl/miembro.html?estado=pendiente&tipo=region</font>"
)
story.append(Paragraph(links_text, body_style))

doc.build(story, canvasmaker=NumberedCanvas)

# Copiar al directorio de artefactos
with open(pdf_filename, 'rb') as f_in:
    with open(artifact_pdf, 'wb') as f_out:
        f_out.write(f_in.read())

print("PDF generado con éxito:", pdf_filename)
