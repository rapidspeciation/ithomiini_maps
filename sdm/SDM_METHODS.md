# Species Distribution Modelling — Methods and Pipeline Documentation

## Overview

This document details the species distribution modelling (SDM) pipeline developed for the Ithomiini Distribution Maps web application. The pipeline generates ensemble habitat suitability predictions for Neotropical Ithomiini butterflies using a tiered modelling approach based on sample size, following current best practices in the SDM literature.

## 1. Occurrence Data

### Sources

| Source | Records | Species | Notes |
|--------|---------|---------|-------|
| Sanger Institute | 7,268 | 513 | Targeted collecting expeditions, mostly Ecuador (Napo Province) |
| iNaturalist (via GBIF) | 19,901 | 252 | Citizen-science observations, research grade |
| GBIF (Other Institutions) | 28,182 | 428 | Museum specimens from multiple collections |
| GBIF (UNAM) | 21,586 | 35 | Universidad Nacional Autónoma de México |
| **Total** | **76,937** | **459** | |

### Excluded: Dore et al. (2022)

The Dore et al. (2022) dataset (28,927 records, 387 species) was excluded from the SDM pipeline despite being the largest single dataset. This dataset reports occurrences as centroids of 0.25° grid cells (~28 km), not actual collection localities. Including grid centroids would:

1. Introduce false spatial precision — a point at a grid centroid does not represent where the butterfly was actually collected within that ~28 km cell.
2. Conflict with the ~1 km resolution of the CHELSA environmental layers — the environmental values at a grid centroid may not represent conditions at the true collection site.
3. Bias models toward grid-centre coordinates rather than ecologically meaningful locations.

Dore et al. (2022) remains available in the web application for occurrence visualization and is a valuable reference for species diversity mapping, but its coarse spatial resolution makes it unsuitable for fine-scale SDM.

### Data Cleaning

Records were filtered sequentially:

1. **Tribe filter** — retained only records classified as tribe Ithomiini (75,473 records).
2. **Coordinate cleaning** — removed records with missing, zero, or out-of-range coordinates; removed records outside the Neotropical study extent (−120° to −30°W, −40° to 25°N).
3. **Ocean filter** — removed records falling in the ocean using Natural Earth 110m land polygons (281 records removed). These are GBIF/iNaturalist records with imprecise or erroneous coordinates (e.g., coastal specimens georeferenced into the sea).
4. **Spatial thinning** — applied 5 km spatial thinning to reduce spatial autocorrelation and sampling bias from clustered field station collections. Only one record per 5 km grid cell was retained. This distance was chosen to approximately match the resolution of the environmental layers (~1 km CHELSA) while reducing pseudoreplication.

After cleaning: **75,405 records → 18,017 thinned records** across 459 species.

### Minimum Sample Size

Species with fewer than 20 thinned records were excluded from modelling, following recommendations from Wisz et al. (2008) that presence-only algorithms require a minimum of ~20 records for reliable predictions. This threshold yielded **148 viable species**.

| Tier | Record range | Species | Algorithms |
|------|-------------|---------|------------|
| Small | 20–49 | 65 | MaxEnt only |
| Medium | 50–99 | 37 | MaxEnt + RF + XGBoost |
| Large | 100+ | 46 | MaxEnt + RF + XGBoost |

## 2. Environmental Variables

### Bioclimatic Variables (CHELSA v2.1)

Nine bioclimatic variables from CHELSA v2.1 (Karger et al., 2017) at 30 arc-second (~1 km) resolution, baseline period 1981–2010:

| Variable | Description | Raw encoding | Conversion |
|----------|-------------|-------------|------------|
| BIO1 | Annual Mean Temperature | Kelvin × 10 | × 0.1 − 273.15 → °C |
| BIO2 | Mean Diurnal Range | °C | none |
| BIO4 | Temperature Seasonality | SD × 100 | none (index) |
| BIO5 | Max Temperature of Warmest Month | Kelvin × 10 | × 0.1 − 273.15 → °C |
| BIO6 | Min Temperature of Coldest Month | Kelvin × 10 | × 0.1 − 273.15 → °C |
| BIO12 | Annual Precipitation | mm × 10 | × 0.1 → mm |
| BIO13 | Precipitation of Wettest Month | mm × 10 | × 0.1 → mm |
| BIO14 | Precipitation of Driest Month | mm × 10 | × 0.1 → mm |
| BIO15 | Precipitation Seasonality | Coefficient of variation | none (index) |

CHELSA v2.1 was chosen over WorldClim v2.1 because its orographic wind-field downscaling provides improved accuracy in tropical montane regions (Karger et al., 2017), which is critical for Andean Ithomiini species.

### Topographic Variable

| Variable | Source | Resolution |
|----------|--------|-----------|
| Elevation | WorldClim SRTM | 30 arc-second (~1 km) |

### Cloud Cover

| Variable | Source | Resolution |
|----------|--------|-----------|
| Cloud cover frequency | EarthEnv (Wilson & Jetz, 2016) | ~1 km |

Cloud cover was included as a proxy for humidity and cloud forest habitat, relevant for Ithomiini butterflies that are predominantly cloud forest specialists.

### Variable Selection

Before model fitting, multicollinearity among predictors was reduced using Variance Inflation Factor (VIF) filtering with a threshold of 10. Variables were iteratively removed (highest VIF first) until all remaining variables had VIF < 10. This typically removed 4 of the 11 variables (BIO1, BIO6, elevation, and BIO12), retaining 7 predictors. The exact variables retained may vary slightly per species depending on the accessible area.

### Host Plant Variables — Not Included

Host plant distribution layers (GBIF occurrences of Solanaceae genera rasterized as density surfaces) were prepared but excluded from the current pipeline. Both the circularity concern (plants and butterflies respond to the same climate variables) and the coarse taxonomic resolution (genus-level associations, not species-level) made these layers unsuitable as predictors without further validation. Host plant data remain available for future experimental runs with a two-step modelling approach (model plant distributions first, use predicted plant suitability as butterfly predictor).

## 3. Background Sampling

### Accessible Area

For each species, the accessible area (M; Barve et al., 2011) was defined as the convex hull of all occurrence points buffered by 5°, clipped to the Neotropical study extent. This constrains both background sampling and prediction to areas the species could plausibly access, avoiding inflated discrimination from including distant, obviously unsuitable environments.

### Background Points

10,000 background points were generated within each species' accessible area using target-group sampling (Phillips et al., 2009). Background point density was weighted by a kernel density estimate (KDE, bandwidth = 1°) of all Ithomiini occurrence records, ensuring that background points mimic the spatial bias of the occurrence data (e.g., over-sampling near roads, field stations, and accessible areas).

### Bias Correction Rationale

Target-group background sampling with KDE weighting was chosen because:

1. The Sanger Institute data is heavily clustered around ~15 field stations in eastern Ecuador.
2. GBIF/iNaturalist data is biased toward accessible areas and population centres.
3. Phillips et al. (2009) demonstrated that target-group backgrounds improve model performance when sampling bias is strong.

## 4. Modelling Algorithms

### Tiered Approach

Different modelling strategies were applied based on sample size, following Wisz et al. (2008) who showed that tree-based methods require ≥50 records for reliable performance:

#### Small Tier (20–49 records): MaxEnt Only

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Algorithm | MaxEnt (elapid) | Best performer at small sample sizes (Wisz et al., 2008) |
| beta_multiplier | 2.0 | Higher regularization prevents overfitting with few records (Morales et al., 2017) |
| Feature types | Linear + Quadratic | Simpler features for small samples (Radosavljevic & Anderson, 2014) |
| Output transform | cloglog | Best-justified probability estimate (Phillips et al., 2017) |
| Clamping | Enabled | Prevents extrapolation beyond training range |
| Cross-validation | Jackknife (leave-one-out) | Spatial block CV not feasible with <30 presence points (Pearson et al., 2007) |

#### Medium Tier (50–99 records): Full Ensemble

| Parameter | MaxEnt | Random Forest | XGBoost |
|-----------|--------|---------------|---------|
| beta_multiplier / depth | 1.5 | max_depth=15 | max_depth=3 |
| Features / trees | L + Q + Hinge | 500 trees, max_features=sqrt | 500 trees, lr=0.05 |
| Regularization | cloglog, clamped | min_samples_leaf=max(5, n/20) | subsample=0.75, early_stopping=30 |
| CV | 5-fold spatial block | 5-fold spatial block | 5-fold spatial block |

#### Large Tier (100+ records): Full Ensemble

Same as medium tier, except XGBoost uses learning_rate=0.01 and n_estimators=1500 (more trees with slower learning for larger datasets; Elith et al., 2008).

### MaxEnt (elapid)

MaxEnt was implemented via the `elapid` Python package (Christensen, 2022), which provides a native Python implementation of the maximum entropy algorithm. Key parameters:

- `beta_multiplier`: Controls regularization strength. Higher values produce smoother, less overfit models. Set to 2.0 for small samples and 1.5 for medium/large, following Morales et al. (2017) and Radosavljevic & Anderson (2014).
- `transform='cloglog'`: Complementary log-log output, the most defensible probability-scale interpretation of MaxEnt output (Phillips et al., 2017).
- `clamp=True`: Restricts predictions to the range of training data, preventing unreliable extrapolation.
- `tau=0.5`: Logistic output scaling parameter (only affects logistic transform, not cloglog).

### Random Forest (scikit-learn)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| n_estimators | 500 | Sufficient for convergence |
| max_depth | 15 | Deeper than default to capture complex environmental gradients; 8 was too conservative (Valavi et al., 2021) |
| max_features | sqrt | Standard practice, reduces correlation between trees |
| min_samples_leaf | max(5, n_presences/20) | Prevents overfitting on small samples |
| class_weight | {0: 1, 1: n_bg/n_pres} | Compensates for presence/background imbalance |

### XGBoost

| Parameter | Value (n<200) | Value (n≥200) | Rationale |
|-----------|---------------|---------------|-----------|
| n_estimators | 500 | 1,500 | More trees for larger datasets |
| max_depth | 3 | 3 | Shallow trees prevent overfitting (Elith et al., 2008) |
| learning_rate | 0.05 | 0.01 | Slower learning with more trees |
| subsample | 0.75 | 0.75 | Row subsampling reduces overfitting |
| colsample_bytree | 0.75 | 0.75 | Column subsampling adds diversity |
| early_stopping_rounds | 30 | 30 | Stops when validation loss plateaus |
| scale_pos_weight | n_bg/n_pres | n_bg/n_pres | Class imbalance correction |

A 15% validation split was used for early stopping to prevent overfitting.

### Ensemble Method

Predictions from individual algorithms were combined using a weighted mean, with weights proportional to each algorithm's cross-validated AUC:

```
weight_i = max(0, AUC_i − 0.5)
```

Algorithms with AUC < 0.5 (worse than random) were excluded from the ensemble. AUC-weighted ensembles were chosen as the top-performing method across 225 species in Valavi et al. (2021).

### Per-species Tuning for Weak Models

Species with cross-validated Boyce Index < 0.3 are flagged as weak-performance and undergo an additional ENMeval-style grid search over MaxEnt parameters (Kass et al., 2021). Script: `sdm/06_tune_weak_species.py`.

**Grid:**

| Parameter | Values | Baseline default |
|-----------|--------|------------------|
| Regularization multiplier (RM) | 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0 | 1.5 (medium/large), 2.0 (small) |
| Feature classes | L, LQ, LQH, LQHP | LQ (small), LQH (medium/large) |

8 × 4 = 32 cells per species, fitted with 5-fold spatial block cross-validation (identical to the main pipeline).

**Selection criterion:** highest CV Boyce Index; ties within 0.01 are broken in favor of fewer/simpler feature classes (linear < quadratic < hinge < product), following the parsimony principle of Warren & Seifert (2011).

We deviate from the strict AICc criterion used in the ENMeval reference implementation. AICc on MaxEnt requires study-area-wide normalization of raw outputs — non-trivial additional compute — and the ENMeval 2.0 vignette (Kass et al., 2021, §2.4) explicitly supports CV metrics as an alternative selection criterion. CV Boyce also directly optimises the metric we report to end users.

**Output:** `sdm/species_overrides.json` stores the winning `(maxent_rm, maxent_features)` for each tuned species. `04_run_sdm.py` consults this file on startup and applies overrides before fitting MaxEnt; species without entries fall back to tier defaults.

**Expected impact:** modest Boyce improvements (Δ ≈ 0.05–0.15) for some weak species. Widespread generalists (e.g., *Mechanitis messenoides*) often remain weakly predicted regardless of tuning, reflecting genuinely diffuse environmental signal rather than pipeline defects (Adelino et al., 2020; Santini et al., 2021). Sample size < 200 and broad niche breadth both impose lower ceilings on attainable Boyce (Santini et al., 2021).

**Scheduling:** the tuning script supports graceful SIGTERM shutdown (finishes the current species before exiting), `--resume` to skip completed species, and `--time-limit` to bound wall-clock time. This enables scheduled overnight runs on workstations with time-limited availability.

## 5. Model Evaluation

### Cross-Validation

- **Spatial block CV** (5-fold) for species with ≥30 records: Training and test sets are geographically separated to account for spatial autocorrelation (Valavi et al., 2019; Roberts et al., 2017). Block size was determined automatically based on the spatial extent of occurrences.
- **Jackknife CV** (leave-one-out on presences) for species with <30 records: Each presence point is left out in turn and the model is evaluated on its prediction at that location (Pearson et al., 2007).

### Metrics

| Metric | Description | Interpretation |
|--------|-------------|---------------|
| AUC | Area Under the ROC Curve | Discrimination ability; 0.5 = random, 1.0 = perfect. Note: AUC is extent-dependent and structurally lower for widespread species (Lobo et al., 2008) |
| Boyce Index | Continuous Boyce Index | Calibration metric for presence-only models; positive = model correctly ranks habitats, negative = miscalibrated (Hirzel et al., 2006) |
| TSS | True Skill Statistic | Threshold-dependent discrimination; less prevalence-dependent than AUC |

AUC alone should not be used to compare model quality across species with different range sizes (Jiménez-Valverde, 2012). The Boyce Index provides a complementary assessment of whether high-suitability areas genuinely contain more occurrences.

### Confidence Ratings

Each species model is assigned a confidence rating:

| Rating | Criteria | Interpretation |
|--------|----------|---------------|
| High | ≥100 records, full ensemble | Reliable predictions |
| Medium | 50–99 records, full ensemble | Moderate reliability |
| Low | 20–49 records, MaxEnt only | Use with caution |
| Exploratory | Best AUC < 0.5 | Model failed; predictions unreliable |

## 6. Prediction and Post-processing

### Prediction Extent

Predictions were generated within each species' accessible area (buffered convex hull), not across the full Neotropics. This prevents misleading extrapolation into environments the model has never seen during training (Barve et al., 2011; Elith et al., 2010). Predictions outside the accessible area should not be interpreted as "unsuitable" — they are simply areas where the model has no information.

### Land Masking

Ocean pixels were set to nodata using Natural Earth 110m land polygons, removing prediction artefacts over water.

### Resolution

Predictions were generated at 0.1° (~11 km) resolution. This balances computational cost with ecological relevance for broad-scale distribution mapping.

### MESS Maps

Multivariate Environmental Similarity Surfaces (MESS; Elith et al., 2010) were generated for each species to identify areas of environmental novelty — locations where prediction values fall outside the range of training data. MESS < 0 indicates extrapolation; predictions in these areas should be interpreted cautiously.

### Response Curves

For each species, partial dependence response curves were generated for each environmental variable by predicting suitability across a gradient of one variable while holding all others at their mean (presence points only). Response curves from all algorithms in the ensemble were averaged, with the standard deviation representing inter-algorithm uncertainty.

Each variable reports:
- **Optimal range**: the value range where mean predicted suitability is ≥80% of the peak.
- **Importance**: the range of the response (max − min suitability across the gradient); higher values indicate stronger influence on the model.
- **Confidence**: 1 − (standard deviation / mean) at the peak, measuring agreement between algorithms.

## 7. Web Application Integration

### Data Flow

```
SDM Pipeline (Python)
  └── GeoTIFF predictions (per species)
        └── Step 5: Export
              ├── sdm_metadata.json (species list, metrics, response curves)
              └── species/*.tif (ensemble predictions)

Web App (Vue 3 + MapLibre GL JS)
  └── useSDMLayer.js (composable)
        ├── Loads GeoTIFF via geotiff.js
        ├── Renders to canvas with color ramp
        ├── Adds as MapLibre image source
        └── Cursor suitability tooltip
```

### Visualization

- Single species: colourblind-safe warm orange ramp, with higher suitability shown as darker/more saturated orange.
- Two species: colourblind-safe orange + blue overlay for visual range comparison.
- Suitability values below 5% are rendered transparent (below noise threshold).
- Cursor tooltip shows the suitability percentage at the mouse position.
- Confidence badges (high/medium/low/exploratory) indicate model reliability.
- Response curves displayed as inline sparklines with optimal range highlights.

## 8. Results

### Summary Statistics

| Metric | Value |
|--------|-------|
| Species modelled | **151** (147 Ithomiini + 4 Heliconiini) |
| Mean AUC | **0.729** (median 0.731) |
| Mean Boyce Index | **0.522** (median 0.562) |
| Species with AUC > 0.7 | **100 (67%)** |
| Species with positive Boyce | **134 (89%)** |
| Species rated "high" confidence | 46 |
| Species rated "medium" confidence | 35 |
| Species rated "low" confidence | 69 |
| Species rated "exploratory" | 1 |

### Performance by Tier

| Tier | N species | Mean AUC | Mean Boyce | AUC range |
|------|-----------|----------|------------|-----------|
| Large (100+) | 46 | 0.679 | 0.293 | 0.526–0.799 |
| Medium (50–99) | 36 | 0.712 | 0.284 | 0.559–0.847 |
| Small (20–49) | 69 | 0.771 | 0.796 | 0.619–0.963 |

The inverse relationship between sample size and AUC (large-tier species show lower AUC than small-tier species) is the documented statistical artefact of Lobo et al. (2008) and Jiménez-Valverde (2012): widespread species occupying a large fraction of the study area have structurally lower achievable AUC, regardless of model quality. The Boyce Index provides a more informative cross-tier comparison and shows that small-tier range-restricted species achieve excellent calibration (mean Boyce 0.80).

### Most Important Environmental Variables

Variable importance was computed as the range of predicted suitability (max − min) across each variable's gradient, holding other variables at their mean values.

| Rank | Variable | Mean importance | Top predictor for N species |
|------|----------|----------------|---------------------------|
| 1 | Precipitation Seasonality | 0.451 | 34 species |
| 2 | Temperature Seasonality | 0.425 | 33 species |
| 3 | Max Temperature of Warmest Month | 0.419 | 34 species |
| 4 | Elevation | 0.391 | 3 species (only 10 species retained it after VIF) |
| 5 | Cloud Cover | 0.382 | 22 species |
| 6 | Diurnal Range | 0.341 | 16 species |
| 7 | Precipitation of Driest Month | 0.261 | 3 species |
| 8 | Precipitation of Wettest Month | 0.256 | 6 species |
| 9 | Annual Precipitation | 0.082 | 0 species (VIF-removed for most) |

Seasonality metrics (both precipitation and temperature) are the strongest predictors overall, consistent with Ithomiini biogeography: many species track specific seasonal climatic regimes within wet tropical forests. Cloud cover ranks in the top tier for cloud forest specialists; elevation emerges as a top predictor only when it survives VIF filtering (it correlates strongly with temperature variables in most species' accessible areas). Annual Precipitation rarely survives VIF because it correlates with the wettest/driest month variables.

### Reference Species Results

| Species | Records | Tier | AUC | Boyce | Confidence |
|---------|---------|------|-----|-------|------------|
| *Mechanitis polymnia* | 1,295 | large | 0.640 | 0.847 | high |
| *Mechanitis lysimnia* | 816 | large | 0.678 | 0.716 | high |
| *Mechanitis messenoides* | 97 | medium | 0.768 | 0.342 | medium |
| *Heterosais giulia* | 57 | medium | 0.587 | −0.009 | medium |
| *Heliconius erato* | 23 | small | 0.717 | 0.902 | low |
| *Heliconius numata* | 21 | small | 0.803 | 0.742 | low |
| *Heliconius sara* | 22 | small | 0.806 | 0.853 | low |
| *Dryas iulia* | 20 | small | 0.813 | 0.951 | low |

The widespread *M. polymnia* (AUC 0.640) and the narrow-range *D. iulia* (AUC 0.813) both have excellent calibration (Boyce 0.85 and 0.95 respectively) despite very different AUC values — another illustration of why Boyce Index is more appropriate than AUC alone for comparing species with different range sizes.

## 9. Limitations

1. **Presence-only data**: Models predict relative habitat suitability, not true probability of occurrence. Absence of a species from a predicted suitable area may reflect sampling gaps rather than true absence.
2. **Temporal mismatch**: Occurrence records span 1950s–2025 but environmental layers represent 1981–2010 (CHELSA) or 2000–2014 (cloud cover). Land use change is not accounted for.
3. **Spatial bias**: Despite target-group background sampling and spatial thinning, residual collector bias may remain, particularly for the Sanger data clustered around Ecuadorian field stations.
4. **Resolution**: The 0.1° prediction resolution (~11 km) may be too coarse for narrow-range Andean cloud forest species where elevational shifts of 200 m matter.
5. **No dispersal constraints**: Models predict climatically suitable areas without considering dispersal barriers (e.g., the Andes, major rivers, deforested corridors).
6. **Per-species tuning scope**: MaxEnt parameters are grid-searched per species only for weak-performance models (Boyce < 0.3, see §4). Well-performing species retain tier defaults. Tuning the remaining ~134 species would yield diminishing returns where baseline Boyce already exceeds 0.5.
7. **Widespread generalists**: Species with broad niches and wide geographic ranges (e.g., *Mechanitis messenoides*, *Hypothyris euclea*) often retain low Boyce scores even after tuning. This reflects genuinely diffuse climatic signal rather than pipeline defects (Adelino et al., 2020). Predictions for such species should be interpreted as relative suitability ranking, not probability of occurrence.

## 10. Comparison with Doré et al. (2022)

The most relevant prior work is Doré et al. (2022), who modelled 388 Ithomiini species. Key methodological differences:

| Aspect | Doré et al. (2022) | This pipeline |
|--------|-------------------|---------------|
| Resolution | 0.25° (~28 km) | 0.1° (~11 km) |
| Climate data | MERRAclim | CHELSA v2.1 |
| Algorithms | RF + GBM + ANN | MaxEnt + RF + XGBoost |
| MaxEnt included | No | Yes |
| Min sample size | 6 records | 20 records |
| Small-sample evaluation | Training data (Jaccard > 0.95) | Jackknife CV |
| Background extent | Entire Neotropics | Species-specific accessible area |
| Post-processing | Alpha-hull clipping + Andean divide | Land mask only |
| Prediction purpose | Diversity hotspot mapping | Species-level web visualization |

Notable differences: this pipeline includes MaxEnt (the best-performing algorithm for small samples), uses finer resolution, employs CHELSA (better orographic correction for Andean species), and evaluates small-sample models with jackknife CV rather than training-data metrics.

## References

- Adelino, J.R.P., Heming, N.M., Boria, R.A., Borges, R.C., Mariano, E.F. & Gonçalves-Souza, T. (2020). Deciphering ecology from statistical artefacts: Competing influence of sample size, prevalence and habitat specialization on species distribution models. *Diversity and Distributions*, 26(3), 336–349. DOI: 10.1111/ddi.13030
- Aiello-Lammens, M.E., Boria, R.A., Radosavljevic, A., Vilela, B. & Anderson, R.P. (2015). spThin: an R package for spatial thinning of species occurrence records for use in ecological niche models. *Ecography*, 38(5), 541–545. DOI: 10.1111/ecog.01132
- Araújo, M.B., Anderson, R.P., Barbosa, A.M., Beale, C.M., Dormann, C.F., Early, R. *et al.* (2019). Standards for distribution models in biodiversity assessments. *Science Advances*, 5(1), eaat4858. DOI: 10.1126/sciadv.aat4858
- Barbet-Massin, M., Jiguet, F., Albert, C.H. & Thuiller, W. (2012). Selecting pseudo-absences for species distribution models: how, where and how many? *Methods in Ecology and Evolution*, 3(2), 327–338. DOI: 10.1111/j.2041-210X.2011.00172.x
- Barve, N., Barve, V., Jiménez-Valverde, A., Lira-Noriega, A., Maher, S.P., Peterson, A.T., Soberón, J. & Villalobos, F. (2011). The crucial role of the accessible area in ecological niche modeling and species distribution modeling. *Ecological Modelling*, 222(11), 1810–1819. DOI: 10.1016/j.ecolmodel.2011.02.011
- Christensen, A. (2022). elapid: Species distribution modeling tools for Python. *Journal of Open Source Software*, 7(80), 4930. DOI: 10.21105/joss.04930
- Doré, M., Willmott, K.R., Leroy, B., Chazot, N., Mallet, J., Freitas, A.V.L., Hall, J.P.W., Lamas, G., Dasmahapatra, K.K., Fontaine, C. & Elias, M. (2022). Anthropogenic pressures coincide with Neotropical biodiversity hotspots in a flagship butterfly group. *Diversity and Distributions*, 28(7), 1104–1120. DOI: 10.1111/ddi.13455
- Elith, J., Kearney, M. & Phillips, S. (2010). The art of modelling range-shifting species. *Methods in Ecology and Evolution*, 1(4), 330–342. DOI: 10.1111/j.2041-210X.2010.00036.x
- Elith, J., Leathwick, J.R. & Hastie, T. (2008). A working guide to boosted regression trees. *Journal of Animal Ecology*, 77(4), 802–813. DOI: 10.1111/j.1365-2656.2008.01390.x
- Hirzel, A.H., Le Lay, G., Helfer, V., Randin, C. & Guisan, A. (2006). Evaluating the ability of habitat suitability models to predict species presences. *Ecological Modelling*, 199(2), 142–152. DOI: 10.1016/j.ecolmodel.2006.05.017
- Jiménez-Valverde, A. (2012). Insights into the area under the receiver operating characteristic curve (AUC) as a discrimination measure in species distribution modelling. *Global Ecology and Biogeography*, 21(4), 498–507. DOI: 10.1111/j.1466-8238.2011.00683.x
- Karger, D.N., Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R.W., Zimmermann, N.E., Linder, H.P. & Kessler, M. (2017). Climatologies at high resolution for the earth's land surface areas. *Scientific Data*, 4, 170122. DOI: 10.1038/sdata.2017.122
- Kass, J.M., Muscarella, R., Galante, P.J., Bohl, C.L., Pinilla-Buitrago, G.E., Boria, R.A., Soley-Guardia, M. & Anderson, R.P. (2021). ENMeval 2.0: redesigned for customizable and reproducible modeling of species' niches and distributions. *Methods in Ecology and Evolution*, 12(9), 1602–1608. DOI: 10.1111/2041-210X.13628
- Lobo, J.M., Jiménez-Valverde, A. & Real, R. (2008). AUC: a misleading measure of the performance of predictive distribution models. *Global Ecology and Biogeography*, 17(2), 145–151. DOI: 10.1111/j.1466-8238.2007.00358.x
- Morales, N.S., Fernández, I.C. & Baca-González, V. (2017). MaxEnt's parameter configuration and small samples: are we paying attention to recommendations? A systematic review. *PeerJ*, 5, e3093. DOI: 10.7717/peerj.3093
- Pearson, R.G., Raxworthy, C.J., Nakamura, M. & Peterson, A.T. (2007). Predicting species distributions from small numbers of occurrence records: a test case using cryptic geckos in Madagascar. *Journal of Biogeography*, 34(1), 102–117. DOI: 10.1111/j.1365-2699.2006.01594.x
- Phillips, S.J., Anderson, R.P., Dudík, M., Schapire, R.E. & Blair, M.E. (2017). Opening the black box: an open-source release of Maxent. *Ecography*, 40(7), 887–893. DOI: 10.1111/ecog.03049
- Phillips, S.J., Dudík, M., Elith, J., Graham, C.H., Lehmann, A., Leathwick, J. & Ferrier, S. (2009). Sample selection bias and presence-only distribution models: implications for background and pseudo-absence data. *Ecological Applications*, 19(1), 181–197. DOI: 10.1890/07-2153.1
- Radosavljevic, A. & Anderson, R.P. (2014). Making better Maxent models of species distributions: complexity, overfitting and evaluation. *Journal of Biogeography*, 41(4), 629–643. DOI: 10.1111/jbi.12227
- Roberts, D.R., Bahn, V., Ciuti, S., Boyce, M.S., Elith, J., Guillera-Arroita, G., Hauenstein, S., Lahoz-Monfort, J.J., Schröder, B., Thuiller, W., Warton, D.I., Wintle, B.A., Hartig, F. & Dormann, C.F. (2017). Cross-validation strategies for data with temporal, spatial, hierarchical, or phylogenetic structure. *Ecography*, 40(8), 913–929. DOI: 10.1111/ecog.02881
- Santini, L., Benítez-López, A., Maiorano, L., Čengić, M. & Huijbregts, M.A.J. (2021). Assessing the reliability of species distribution projections in climate change research. *Diversity and Distributions*, 27(2), 207–216. DOI: 10.1111/ddi.13211
- Valavi, R., Elith, J., Lahoz-Monfort, J.J. & Guillera-Arroita, G. (2019). blockCV: An r package for generating spatially or environmentally separated folds for k-fold cross-validation of species distribution models. *Methods in Ecology and Evolution*, 10(2), 225–232. DOI: 10.1111/2041-210X.13107
- Valavi, R., Guillera-Arroita, G., Lahoz-Monfort, J.J. & Elith, J. (2021). Predictive performance of presence-only species distribution models: a benchmark study with reproducible code. *Ecological Monographs*, 92(1), e1486. DOI: 10.1002/ecm.1486
- Warren, D.L. & Seifert, S.N. (2011). Ecological niche modeling in Maxent: the importance of model complexity and the performance of model selection criteria. *Ecological Applications*, 21(2), 335–342. DOI: 10.1890/10-1171.1
- Wilson, A.M. & Jetz, W. (2016). Remotely sensed high-resolution global cloud dynamics for predicting ecosystem and biodiversity distributions. *PLoS Biology*, 14(3), e1002415. DOI: 10.1371/journal.pbio.1002415
- Wisz, M.S., Hijmans, R.J., Li, J., Peterson, A.T., Graham, C.H., Guisan, A. & NCEAS Predicting Species Distributions Working Group (2008). Effects of sample size on the performance of species distribution models. *Diversity and Distributions*, 14(5), 763–773. DOI: 10.1111/j.1472-4642.2008.00482.x
