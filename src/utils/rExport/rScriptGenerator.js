/** The generated file is deliberately plain R. Researchers can edit SETTINGS without regenerating it. */
export function generateRScript() {
  return `# Wings Atlas map export. Run: Rscript --vanilla generate_map.R
# The geographic source data, projected screen positions, legend and view manifest
# are separate files so the map remains easy to inspect and edit.

# 1. EDITABLE SETTINGS -------------------------------------------------------
SETTINGS <- list(
  output_name = "ithomiini_map", # PDF, SVG and PNG share this stem
  output_scale = 1,             # scale all dimensions and labels together
  dpi = 300,                    # raster PNG resolution
  background = "captured",     # "captured", "basemap", or "none"
  show_points = TRUE,
  show_ranges = TRUE,
  show_sdm = TRUE,
  show_host_plants = TRUE,
  show_scale = TRUE,
  show_legend = TRUE,
  legend_offset_x_px = 0,        # move legend right (+) or left (-)
  legend_offset_y_px = 0,        # move legend down (+) or up (-)
  legend_font_multiplier = 1,
  font_family = "sans",         # portable choices: "sans", "serif", "mono"
  legend_background = NULL,     # e.g. "#252540"; NULL uses browser color
  point_radius_multiplier = 1,
  point_opacity_multiplier = 1,
  range_opacity_multiplier = 1,
  palette_overrides = c(),      # e.g. c("Mechanitis polymnia" = "#0072B2")
  show_attribution = TRUE
)

# 2. INPUTS AND DEPENDENCIES -------------------------------------------------
required <- c("jsonlite", "png", "svglite")
missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) stop(
  "Missing R packages: ", paste(missing, collapse = ", "),
  ". Install with install.packages(c(", paste(sprintf('"%s"', missing), collapse = ", "), "))",
  call. = FALSE
)

# A package can load successfully but still use an older R graphics API.
# Check the SVG device before writing any of the map output files.
check_svg_device <- function() {
  probe <- tempfile(fileext = ".svg")
  on.exit(unlink(probe))
  tryCatch({
    svglite::svglite(probe, width = 1, height = 1)
    grDevices::dev.off()
  }, error = function(error) {
    detail <- conditionMessage(error)
    if (grepl("Graphics API version mismatch", detail, fixed = TRUE)) {
      stop(
        "svglite is incompatible with this R graphics API. Running ", R.version.string,
        "; svglite was built with ", utils::packageDescription("svglite")$Built,
        ". Reinstall it for this R version with install.packages(\\\"svglite\\\", type = \\\"source\\\"), ",
        "then restart R/RStudio and rerun this script. No map outputs were written.",
        call. = FALSE
      )
    }
    stop("Cannot open the SVG graphics device: ", detail, call. = FALSE)
  })
}
check_svg_device()

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
source_files <- lapply(sys.frames(), function(frame) frame$ofile)
source_files <- Filter(Negate(is.null), source_files)
script_file <- if (length(file_arg)) sub("^--file=", "", file_arg[1]) else if (length(source_files)) tail(source_files, 1)[[1]] else "generate_map.R"
input_dir <- dirname(normalizePath(script_file, mustWork = TRUE))
input <- function(name) file.path(input_dir, name)
read_json <- function(name) jsonlite::fromJSON(input(name), simplifyVector = FALSE)
view <- read_json("view_config.json")
data <- read_json("data.geojson")
legend <- read_json("legend.json")
ranges <- if (file.exists(input("range_polygons.geojson"))) read_json("range_polygons.geojson") else NULL
host_plants <- if (file.exists(input("host_plants.geojson"))) read_json("host_plants.geojson") else NULL
width_px <- view$canvas$width
height_px <- view$canvas$height
width_in <- width_px / 96 * SETTINGS$output_scale
height_in <- height_px / 96 * SETTINGS$output_scale
if (width_in <= 0 || height_in <= 0) stop("Invalid canvas dimensions", call. = FALSE)
if (view$pitch != 0) warning("Map pitch was captured in projected point positions; polygon edges between vertices are straight in the export.")

# CSS rgba() values come from the browser's computed legend styles.
color <- function(value, opacity = 1) {
  if (is.null(value) || !nzchar(value)) return(grDevices::adjustcolor("#000000", alpha.f = 0))
  if (grepl("^rgba?\\\\(", value)) {
    nums <- as.numeric(strsplit(gsub("[^0-9.,]", "", value), ",")[[1]])
    if (length(nums) >= 3) return(grDevices::rgb(nums[1], nums[2], nums[3], alpha = 255 * (if (length(nums) >= 4) nums[4] else 1) * opacity, maxColorValue = 255))
  }
  grDevices::adjustcolor(value, alpha.f = opacity)
}
read_screen_png <- function(filename, opacity = 1) {
  image <- png::readPNG(input(filename))
  if (length(dim(image)) == 3 && dim(image)[3] == 4) image[, , 4] <- image[, , 4] * opacity
  # grid's reversed native y scale maps browser y=0 to the top. Its raster
  # cell order must be reversed once so the map labels remain upright.
  if (length(dim(image)) == 3) image[dim(image)[1]:1, , , drop = FALSE]
  else image[nrow(image):1, , drop = FALSE]
}
clamp <- function(x) max(0, min(1, x))
at <- function(x, y) list(x = grid::unit(x, "native"), y = grid::unit(y, "native"))

# 3. DRAW EDITABLE SCIENTIFIC LAYERS ----------------------------------------
# Stored x/y are MapLibre CSS pixels from the exact exported view. GeoJSON
# longitude/latitude remain in data.geojson for geographic editing or reuse.
draw_shape <- function(x, y, radius, shape, fill, stroke, line_width) {
  # R's lwd uses 1/96 inch units; browser stroke widths are CSS pixels.
  gp <- grid::gpar(fill = fill, col = stroke, lwd = line_width * SETTINGS$output_scale)
  if (is.null(shape) || shape == "circle") {
    grid::grid.circle(x = grid::unit(x, "native"), y = grid::unit(y, "native"),
      r = grid::unit(radius * SETTINGS$output_scale * 72 / 96, "pt"), gp = gp)
    return(invisible(NULL))
  }
  if (shape == "square") {
    xx <- x + c(-radius, radius, radius, -radius)
    yy <- y + c(-radius, -radius, radius, radius)
  } else if (shape == "triangle") {
    xx <- x + radius * c(0, 1, -1)
    yy <- y + radius * c(-0.866, 0.866, 0.866)
  } else if (shape %in% c("rhombus", "diamond")) {
    xx <- x + radius * c(0, 1, 0, -1)
    yy <- y + radius * c(-1, 0, 1, 0)
  } else {
    stop("Unknown point shape: ", shape, call. = FALSE)
  }
  grid::grid.polygon(x = grid::unit(xx, "native"), y = grid::unit(yy, "native"), gp = gp)
}

# A site holding several colour groups is a pie; slices follow the legend
# order and start at 12 o'clock, as in the browser. Screen y points down.
draw_pie <- function(x, y, radius, segments, fill_opacity, stroke, line_width) {
  start <- -pi / 2
  for (segment in segments) {
    end <- start + 2 * pi * segment$fraction
    angles <- seq(start, end, length.out = max(3, ceiling(96 * segment$fraction)))
    fill <- segment$color
    if (!is.null(segment$label) && segment$label %in% names(SETTINGS$palette_overrides)) {
      fill <- SETTINGS$palette_overrides[[segment$label]]
    }
    grid::grid.polygon(x = grid::unit(c(x, x + radius * cos(angles)), "native"),
      y = grid::unit(c(y, y + radius * sin(angles)), "native"),
      gp = grid::gpar(fill = color(fill, fill_opacity), col = NA))
    start <- end
  }
  grid::grid.circle(x = grid::unit(x, "native"), y = grid::unit(y, "native"),
    r = grid::unit(radius * SETTINGS$output_scale * 72 / 96, "pt"),
    gp = grid::gpar(fill = NA, col = stroke, lwd = line_width * SETTINGS$output_scale))
}

# Polygon rings retain their holes using grid.path's even/odd fill rule.
draw_polygon <- function(geometry, fill, stroke, line_width) {
  polygons <- if (geometry$type == "Polygon") list(geometry$coordinates) else geometry$coordinates
  for (polygon in polygons) {
    xs <- ys <- numeric()
    ids <- integer()
    for (ring_index in seq_along(polygon)) {
      ring <- polygon[[ring_index]]
      xs <- c(xs, vapply(ring, function(p) p[[1]], numeric(1)))
      ys <- c(ys, vapply(ring, function(p) p[[2]], numeric(1)))
      ids <- c(ids, rep(ring_index, length(ring)))
    }
    grid::grid.path(x = grid::unit(xs, "native"), y = grid::unit(ys, "native"),
      id = ids, rule = "evenodd",
      gp = grid::gpar(fill = fill, col = stroke,
        lwd = line_width * SETTINGS$output_scale))
  }
}

paint_ranges <- function() {
  if (!SETTINGS$show_ranges || is.null(ranges)) return(invisible(NULL))
  style <- view$layers$rangeStyle
  for (feature in ranges$features) {
    props <- feature$properties
    if (view$rangeMethod == "hexbin") {
      stops <- c("#FFE57F", "#FFCA28", "#FFA726", "#FF7043", "#F44336", "#C62828")
      density <- as.numeric(props$density)
      # The browser interpolates these colors continuously; this uses the
      # exact six stops and linearly mixes neighboring RGB values.
      t <- pmin(5, pmax(0, density * 5)); i <- min(5, floor(t) + 1)
      a <- grDevices::col2rgb(stops[i])[, 1]; b <- grDevices::col2rgb(stops[i + 1])[, 1]
      rgb <- round(a + (b - a) * (t - (i - 1)))
      fill_color <- grDevices::rgb(rgb[1], rgb[2], rgb[3], maxColorValue = 255)
      outline <- color("#000000", style$outlineOpacity)
    } else {
      fill_color <- props$color
      outline <- color(fill_color, style$outlineOpacity)
    }
    draw_polygon(feature$screen_geometry,
      color(fill_color, clamp(style$fillOpacity * SETTINGS$range_opacity_multiplier)),
      outline, style$outlineWidth)
  }
}

# Each feature is one site marker (or one record in range mode). Marker size
# grows with individuals via display_size_factor; set it to 1 for equal sizes.
paint_points <- function() {
  if (!SETTINGS$show_points || view$layers$editablePoints == 0) return(invisible(NULL))
  style <- view$layers$pointStyle
  fill_opacity <- clamp(style$fillOpacity * SETTINGS$point_opacity_multiplier)
  for (feature in data$features) {
    p <- feature$properties
    size <- if (is.null(p$display_size_factor)) 1 else p$display_size_factor
    radius <- style$radius * size * SETTINGS$point_radius_multiplier + style$strokeWidth / 2
    stroke <- p$display_stroke_color
    if (is.null(stroke)) stroke <- style$strokeColor
    if (length(p$display_segments) > 1) {
      draw_pie(p$screen_x, p$screen_y, radius, p$display_segments, fill_opacity,
        color(stroke, style$strokeOpacity), style$strokeWidth)
      next
    }
    fill <- p$display_color
    category <- if (is.null(p$display_label)) p[[view$colorAttribute]] else p$display_label
    if (!is.null(category) && category %in% names(SETTINGS$palette_overrides)) {
      fill <- SETTINGS$palette_overrides[[category]]
    }
    draw_shape(p$screen_x, p$screen_y, radius,
      if (style$useShapes && !is.null(p$display_shape)) p$display_shape else "circle",
      color(fill, fill_opacity), color(stroke, style$strokeOpacity), style$strokeWidth)
  }
}

paint_host_plants <- function() {
  if (!SETTINGS$show_host_plants || is.null(host_plants)) return(invisible(NULL))
  style <- host_plants$style
  for (feature in host_plants$features) {
    p <- feature$properties
    draw_shape(p$screen_x, p$screen_y, style$size / 2, "triangle",
      color(p$display_color, style$opacity),
      color(style$borderColor, style$opacity), style$borderWidth)
  }
}

paint_sdm <- function() {
  if (!SETTINGS$show_sdm || is.null(view$layers$sdmRasters)) return(invisible(NULL))
  # An aggregate heatmap/cluster background already contains SDM pixels at
  # the browser layer order; do not paint its separate SDM PNG a second time.
  if (view$mode %in% c("heatmap", "clusters") && SETTINGS$background == "captured") return(invisible(NULL))
  for (layer in view$layers$sdmRasters) {
    corners <- layer$corners
    x <- vapply(corners, function(point) point[[1]], numeric(1))
    y <- vapply(corners, function(point) point[[2]], numeric(1))
    width <- sqrt((x[2] - x[1])^2 + (y[2] - y[1])^2)
    height <- sqrt((x[4] - x[1])^2 + (y[4] - y[1])^2)
    angle <- -atan2(y[2] - y[1], x[2] - x[1]) * 180 / pi
    grid::pushViewport(grid::viewport(x = grid::unit(mean(x), "native"),
      y = grid::unit(mean(y), "native"),
      width = grid::unit(width, "native"), height = grid::unit(height, "native"), angle = angle))
    grid::grid.raster(read_screen_png(layer$filename, layer$opacity), width = grid::unit(1, "npc"),
      height = grid::unit(1, "npc"), interpolate = FALSE)
    grid::popViewport()
  }
}

# 4. BACKGROUND AND LEGEND ---------------------------------------------------
paint_background <- function() {
  if (SETTINGS$background == "none") return(invisible(NULL))
  filename <- if (SETTINGS$background == "basemap") "basemap.png" else
    if (file.exists(input("background.png"))) "background.png" else "basemap.png"
  image <- read_screen_png(filename)
  grid::grid.raster(image, x = grid::unit(width_px / 2, "native"),
    y = grid::unit(height_px / 2, "native"),
    width = grid::unit(width_px, "native"), height = grid::unit(height_px, "native"), interpolate = FALSE)
}

paint_legend <- function() {
  if (!SETTINGS$show_legend || !isTRUE(legend$visible)) return(invisible(NULL))
  box <- legend$box
  dx <- SETTINGS$legend_offset_x_px
  dy <- SETTINGS$legend_offset_y_px
  bg <- if (is.null(SETTINGS$legend_background)) legend$background else SETTINGS$legend_background
  grid::grid.roundrect(x = grid::unit(box$x + box$width / 2 + dx, "native"),
    y = grid::unit(box$y + box$height / 2 + dy, "native"),
    width = grid::unit(box$width * SETTINGS$output_scale * 72 / 96, "pt"),
    height = grid::unit(box$height * SETTINGS$output_scale * 72 / 96, "pt"),
    r = grid::unit(8 * SETTINGS$output_scale * 72 / 96, "pt"),
    gp = grid::gpar(fill = color(bg), col = color(legend$border)))
  for (row in legend$rows) {
    if (row$type == "ramp") {
      # Individuals-per-site key: the browser gradient as thin adjacent bars.
      rb <- row$box
      steps <- 64
      colors <- grDevices::colorRampPalette(unlist(row$colors))(steps)
      step_width <- rb$width / steps
      for (i in seq_len(steps)) {
        grid::grid.rect(x = grid::unit(rb$x + (i - 0.5) * step_width + dx, "native"),
          y = grid::unit(rb$y + rb$height / 2 + dy, "native"),
          width = grid::unit(step_width * 1.05 * SETTINGS$output_scale * 72 / 96, "pt"),
          height = grid::unit(rb$height * SETTINGS$output_scale * 72 / 96, "pt"),
          gp = grid::gpar(fill = colors[i], col = NA))
      }
      next
    }
    face <- if (row$fontStyle == "italic") "italic" else if (row$fontWeight %in% c("600", "700", "bold")) "bold" else "plain"
    for (line in row$lines) {
      tb <- line$box
      grid::grid.text(line$text, x = grid::unit(tb$x + dx, "native"),
        y = grid::unit(tb$y + tb$height / 2 + dy, "native"), just = c("left", "center"),
        gp = grid::gpar(col = color(row$color), fontsize = row$fontSize * SETTINGS$legend_font_multiplier * SETTINGS$output_scale * 72 / 96, fontface = face))
    }
    if (row$type == "title" && !is.null(row$dividerWidth) && row$dividerWidth > 0) {
      rb <- row$box
      grid::grid.lines(x = grid::unit(c(rb$x + dx, rb$x + rb$width + dx), "native"),
        y = grid::unit(c(rb$y + rb$height + dy, rb$y + rb$height + dy), "native"),
        gp = grid::gpar(col = color(row$dividerColor), lwd = row$dividerWidth * SETTINGS$output_scale))
    }
    if (row$type == "item" && !is.null(row$shapeBox)) {
      sb <- row$shapeBox
      draw_shape(sb$x + sb$width / 2 + dx, sb$y + sb$height / 2 + dy,
        min(sb$width, sb$height) * 0.35,
        row$shapeType, color(row$shapeColor), color(row$shapeStroke), 0.5)
    }
    if (!is.null(row$countBox) && !is.null(row$count)) {
      cb <- row$countBox
      grid::grid.text(row$count, x = grid::unit(cb$x + dx, "native"),
        y = grid::unit(cb$y + cb$height / 2 + dy, "native"), just = c("left", "center"),
        gp = grid::gpar(col = color(row$countColor), fontsize = row$countFontSize * SETTINGS$legend_font_multiplier * SETTINGS$output_scale * 72 / 96))
    }
  }
}

paint_attribution <- function() {
  if (!SETTINGS$show_attribution) return(invisible(NULL))
  attr <- view$controls$attribution
  if (is.null(attr)) return(invisible(NULL))
  box <- attr$box
  grid::grid.rect(x = grid::unit(box$x + box$width / 2, "native"),
    y = grid::unit(box$y + box$height / 2, "native"),
    width = grid::unit(box$width * SETTINGS$output_scale * 72 / 96, "pt"),
    height = grid::unit(box$height * SETTINGS$output_scale * 72 / 96, "pt"),
    gp = grid::gpar(fill = color(attr$background), col = NA))
  grid::grid.text(attr$text, x = grid::unit(box$x + box$width, "native"),
    y = grid::unit(box$y + box$height / 2, "native"), just = c("right", "center"),
    gp = grid::gpar(col = color(attr$color), fontsize = attr$fontSize * SETTINGS$output_scale * 72 / 96))
}

paint_scale <- function() {
  if (!SETTINGS$show_scale) return(invisible(NULL))
  scale <- view$controls$scale
  if (is.null(scale)) return(invisible(NULL))
  box <- scale$box
  x1 <- box$x; x2 <- box$x + box$width
  y1 <- box$y; y2 <- box$y + box$height
  grid::grid.rect(x = grid::unit((x1 + x2) / 2, "native"),
    y = grid::unit((y1 + y2) / 2, "native"),
    width = grid::unit(box$width * SETTINGS$output_scale * 72 / 96, "pt"),
    height = grid::unit(box$height * SETTINGS$output_scale * 72 / 96, "pt"),
    gp = grid::gpar(fill = color(scale$background), col = NA))
  gp <- grid::gpar(col = color(scale$borderColor), lwd = SETTINGS$output_scale)
  grid::grid.lines(x = grid::unit(c(x1, x1, x2, x2), "native"),
    y = grid::unit(c(y1 + 2, y2, y2, y1 + 2), "native"), gp = gp)
  grid::grid.text(scale$text, x = grid::unit((x1 + x2) / 2, "native"),
    y = grid::unit((y1 + y2) / 2 - 2, "native"), just = c("center", "center"),
    gp = grid::gpar(col = color(scale$color), fontsize = scale$fontSize * SETTINGS$output_scale * 72 / 96))
}

paint_map <- function() {
  grid::grid.newpage()
  grid::pushViewport(grid::viewport(xscale = c(0, width_px), yscale = c(height_px, 0),
    clip = "on", gp = grid::gpar(fontfamily = SETTINGS$font_family)))
  paint_background()
  paint_sdm()
  paint_ranges()
  paint_points()
  paint_host_plants()
  paint_legend()
  paint_scale()
  paint_attribution()
  grid::popViewport()
}

# 5. OUTPUT ------------------------------------------------------------------
output <- function(extension) input(paste0(SETTINGS$output_name, ".", extension))
grDevices::pdf(output("pdf"), width = width_in, height = height_in, useDingbats = FALSE)
paint_map(); grDevices::dev.off()
svglite::svglite(output("svg"), width = width_in, height = height_in)
paint_map(); grDevices::dev.off()
grDevices::png(output("png"), width = width_in * SETTINGS$dpi,
  height = height_in * SETTINGS$dpi, res = SETTINGS$dpi)
paint_map(); grDevices::dev.off()
writeLines(capture.output(utils::sessionInfo()), output("session.txt"))
cat("Created ", output("pdf"), ", ", output("svg"), " and ", output("png"), "\\n", sep = "")
`
}
