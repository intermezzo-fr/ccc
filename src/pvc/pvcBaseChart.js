
/**
 * The main chart component
 */
pvc.BaseChart = pvc.Abstract.extend({
    /**
     * The parent chart.
     * 
     * <p>
     * The root chart has null as the value of its parent property.
     * </p>
     * 
     * @type pvc.BaseChart
     */
    parent: null,
    
    /**
     * The root chart.
     * 
     * <p>
     * The root chart has itself as the value of the root property.
     * </p>
     * 
     * @type pvc.BaseChart
     */
    root: null,
    
    /**
     * A map from visual role name to visual role specification.
     * 
     * @type object
     */
    _roleSpecs: null,

    isPreRendered: false,

    /**
     * Indicates if the chart is rendering with animation.
     */
    isAnimating:   false,
    _renderAnimationStart: false,

    // data
    dataEngine: null,
    resultset:  [],
    metadata:   [],

    // panels
    basePanel:   null,
    titlePanel:  null,
    legendPanel: null,

    legendSource: "series",
    colors: null,

    _renderVersion: 0,
    
    renderCallback: undefined,

    constructor: function(options) {
        this.parent = def.get(options, 'parent') || null;
        if(this.parent) {
            this.owner = this.parent.owner;
            this.dataEngine = def.get(options, 'dataEngine') || 
                              def.fail.argumentRequired('options.dataEngine');
            
            this.left = options.left;
            this.top  = options.top;
            this._roleSpecs = this.parent._roleSpecs;
        } else {
            this.owner = this;
        }
        
        this.options = pvc.mergeDefaults({}, pvc.BaseChart.defaultOptions, options);
    },
    
    /**
     * Processes options after user options and defaults have been merged.
     * Applies restrictions,
     * performs validations and
     * options values implications.
     */
    _processOptions: function(){

        var options = this.options;

        this._processOptionsCore(options);
        
        /* DEBUG options */
        if(pvc.debug && options){
            pvc.log("OPTIONS:\n" + JSON.stringify(options));
        }

        return options;
    },

    /**
     * Processes options after user options and default options have been merged.
     * Override to apply restrictions, perform validation or
     * options values implications.
     * When overriden, the base implementation should be called.
     * The implementation must be idempotent -
     * its successive application should yield the same results.
     * @virtual
     */
    _processOptionsCore: function(options){
        // Disable animation if environment doesn't support it
        if (!$.support.svg || pv.renderer() === 'batik') {
            options.animate = false;
        }

        var margins = options.margins;
        if(margins){
            options.margins = this._parseMargins(margins);
        }
    },
    
    /**
     * Building the visualization has 2 stages:
     * First the preRender method prepares and builds 
     * every object that will be used.
     * Later the render method effectively renders.
     */
    preRender: function() {
        /* Increment render version to allow for cache invalidation  */
        this._renderVersion++;
        this.isPreRendered = false;

        pvc.log("Prerendering in pvc");

        if (!this.parent) {
            // If we don't have data, we just need to set a "no data" message
            // and go on with life.
            // Child charts always have some data
            if(!this.allowNoData && this.resultset.length === 0) {
                throw new NoDataException();
            }
            
            // Now's as good a time as any to completely clear out all
            //  tipsy tooltips
            pvc.removeTipsyLegends();
        }

        /* Options may be changed between renders */
        this._processOptions();

        /* Initialize the data engine */
        this.initDataEngine();

        // Create color schemes
        this.colors = pvc.createColorScheme(this.options.colors);
        this.secondAxisColor = pvc.createColorScheme(this.options.secondAxisColor);

        // Initialize chart panels
        this.initBasePanel();

        this.initTitlePanel();

        this.initLegendPanel();
        
        if(this.parent || !this._isRoleDefined('multiChartColumn')) {
            this._preRenderCore();
        } else {
            this._preRenderMultiChart();
        }
        
        this.isPreRendered = true;
    },

    /**
     * Override to create chart specific content panels here.
     * No need to call base.
     * @virtual
     */
    _preRenderCore: function(){
        /* NOOP */
    },
    
    _preRenderMultiChart: function(){
        var data = this._visualRoleData('multiChartColumn', {visible: true}),
            options = this.options;
        
        // multiChartLimit can be Infinity
        var multiChartLimit = Number(options.multiChartLimit);
        if(isNaN(multiChartLimit) || multiChartLimit < 1) {
            multiChartLimit = Infinity;
        }
        
        var leafCount = data.leafs.length,
            count     = Math.min(leafCount, multiChartLimit);
        
        if(count === 0) {
            if(!this.allowNoData) {
                throw new NoDataException();
            }
            return;
        }
        
        // multiChartWrapColumn can be Infinity
        var multiChartWrapColumn = Number(options.multiChartWrapColumn);
        if(isNaN(multiChartWrapColumn) || multiChartLimit < 1) {
            multiChartWrapColumn = 3;
        }
        
        var colCount   = Math.min(count, multiChartWrapColumn),
            rowCount   = Math.ceil(count / colCount),
            childClass = this.constructor,
            basePanel  = this.basePanel,
            margins    = basePanel.margins,
            left       = margins.left,
            top        = margins.top,
            width      = basePanel.width  / colCount,
            height     = basePanel.height / rowCount;
        
        for(var index = 0 ; index < count ; index++) {
            var childData = data.leafs[index],
                childOptions = def.create(this.options, {
                    parent:     this,
                    title:      childData.absLabel,
                    legend:     false,
                    dataEngine: childData,
                    width:      width,
                    height:     height,
                    left:       left + ((index % colCount) * width),
                    top:        top  + (Math.floor(index / colCount) * height)
                });

            var childChart = new childClass(childOptions);
            childChart.preRender();
        }
    },
    
    /**
     * Initializes the data engine
     */
    initDataEngine: function() {
        var dataEngine  = this.dataEngine;
        
        if(!this.parent) {
            if(pvc.debug){
                this._logResultset();
            }
            
            var complexType = dataEngine ? 
                                dataEngine.type :
                                new pvc.data.ComplexType();
            
            var translation = this._createTranslation(complexType);
            if(translation) {
                translation.configureType();
            }
            
            if(!dataEngine) {
                dataEngine = this.dataEngine = new pvc.data.Data({type: complexType});
            } else {
                // TODO: assert complexType not changed...
            }
            
            this._initRoles();
            
            if(translation) {
                dataEngine.load(translation.execute(dataEngine));
            }
        }
        
        if(pvc.debug){
            pvc.log(dataEngine.getInfo());
        }
    },
    
    _logResultset: function(){
        pvc.log("ROWS");
        if(this.resultset){
            this.resultset.forEach(function(row, index){
                pvc.log("row " + index + ": " + JSON.stringify(row));
            });
        }

        pvc.log("COLS");
        if(this.metadata){
            this.metadata.forEach(function(col){
                pvc.log("column {" +
                    "index: " + col.colIndex +
                    ", name: "  + col.colName +
                    ", label: "  + col.colLabel +
                    ", type: "  + col.colType + "}"
                );
            });
        }
    },
    
    _createTranslation: function(complexType){
        var options = this.options,
            dataOptions = options.dataOptions || {};
        
        var translOptions = {
            secondAxisSeriesIndexes: options.secondAxis ? (options.secondAxisSeriesIndexes || options.secondAxisIdx) : null,
            seriesInRows:      options.seriesInRows,
            crosstabMode:      options.crosstabMode,
            isMultiValued:     options.isMultiValued,
            dimensions:        options.dimensions,
            readers:           options.readers,
            
            measuresIndexes:   options.measuresIndexes, // relational multi-valued
            
            multiChartColumnIndexes: options.multiChartColumnIndexes,
            multiChartRowIndexes: options.multiChartRowIndexes,
            
            // crosstab
            separator:         dataOptions.separator,
            measuresInColumns: dataOptions.measuresInColumns,
            measuresIndex:     dataOptions.measuresIndex || dataOptions.measuresIdx, // measuresInRows
            measuresCount:     dataOptions.measuresCount || dataOptions.numMeasures, // measuresInRows
            categoriesCount:   dataOptions.categoriesCount,
            
            // Timeseries parse format
            isCategoryTimeSeries: options.timeSeries,
            categoryTimeSeriesFormat: options.timeSeries && options.timeSeriesFormat,
            
            // Labels
            categoryFormatter: options.getCategoryLabel,
            seriesFormatter:   options.getSeriesLabel
        };
        
        var translationClass = translOptions.crosstabMode ? 
                pvc.data.CrosstabTranslationOper : 
                pvc.data.RelationalTranslationOper;

        return new translationClass(complexType, this.resultset, this.metadata, translOptions);
    },
    
    _initRoles: function(){
        var data  = this.dataEngine,
            type  = data.type,
            roles = def.copy(this.options.roles);
        
        // Default role mappings
        
        /**
         * Roles that support multiple dimensions.  
         */
        ['series', 'category', 'multiChartColumn', 'multiChartRow'].forEach(function(roleName){
            if(!roles[roleName]) {
                var roleDims = type.groupDimensionsNames(roleName, {assertExists: false});
                if(roleDims) {
                    roles[roleName] = roleDims;
                }
            }
        }, this);
        
        /**
         * Roles that only support one dimension.
         */
        ['value', 'value2'].forEach(function(roleName){
            if(!roles[roleName]) {
                var dimType = type.dimensions(roleName, {assertExists: false});
                if(dimType) {
                    roles[roleName] = roleName;
                }
            }
        }, this);
        
        // --------------
        
        this._roleSpecs = 
            def.query(def.keys(roles))
               .where(def.truthy)
               .object({
                   value: function(name){
                       var groupingSpec = new pvc.data.GroupingSpec(roles[name], data);
                       return new pvc.visual.Role(name, groupingSpec);
                   }
               });
//        
//        this._roleSpecs = {};
//        
//        for(var name in roles) {
//            var role = roles[name];
//            if(role) {
//                var groupingSpec = new pvc.data.GroupingSpec(role, data);
//                this._roleSpecs[name] = new pvc.visual.Role(name, groupingSpec);
//            }
//        }
//        
        // --------------
        
        // TODO: validate required roles?
    },
    
    /**
     * Obtains the data that is assigned to a given role, given its name.
     * 
     * @param {string} roleName The role name.
     * @param {object} keyArgs Keyword arguments.
     * See additional available arguments in {@link pvc.data.Data#groupBy}.
     * @param {boolean} assertExists Indicates if an error should be thrown if the specified role name is undefined.
     * @returns {pvc.data.Data} The role's data if it exists or null if it does not. 
     */
    _visualRoleData: function(roleName, keyArgs){
        var role = this._roleSpecs[roleName];
        if(!role) {
            if(def.get(keyArgs, 'assertExists', true)) {
                throw def.error.argumentInvalid('roleName', "Undefined role name '{0}'.", roleName);
            }
            
            return null;
        }
        
        return this.dataEngine.groupBy(role.grouping, keyArgs);
    },
    
    /**
     * Obtains a roles array or a specific role, given its name.
     * 
     * @param {string} roleName The role name.
     * @param {object} keyArgs Keyword arguments.
     * @param {boolean} assertExists Indicates if an error should be thrown if the specified role name is undefined.
     * 
     * @type pvc.data.VisualRole[]|pvc.data.VisualRole 
     */
    _visualRoles: function(roleName, keyArgs){
        if(roleName == null) {
            return def.own(this._roleSpecs);
        }
        
        var role = def.getOwn(this._roleSpecs, roleName) || null;
        if(!role && def.get(keyArgs, 'assertExists', true)) {
            throw def.error.argumentInvalid('roleName', "Undefined role name '{0}'.", roleName);
        }
        
        return role;
    },
    
    /**
     * Indicates if a role is defined, given its name. 
     * 
     * @param {string} roleName The role name.
     * @type boolean
     */
    _isRoleDefined: function(roleName){
        return !!this._roleSpecs[roleName];
    },
    
    /**
     * Creates and initializes the base (root) panel.
     */
    initBasePanel: function() {
        var options = this.options;
        // Since we don't have a parent panel
        // we need to manually create the points.
        this.originalWidth  = options.width;
        this.originalHeight = options.height;
        
        this.basePanel = new pvc.BasePanel(this, {isRoot: true});
        this.basePanel.setSize(options.width, options.height);
        
        var margins = options.margins;
        if(margins){
            this.basePanel.setMargins(margins);
        }
        
        if(!this.parent) {
            this.basePanel.create();
            this.basePanel.applyExtensions();
            this.basePanel.getPvPanel().canvas(options.canvas);
        } else {
            this.basePanel.appendTo(this.parent.basePanel);
        }
    },

    /**
     * Creates and initializes the title panel,
     * if the title is specified.
     */
    initTitlePanel: function(){
        if (this.options.title != null && this.options.title != "") {
            this.titlePanel = new pvc.TitlePanel(this, {
                title:      this.options.title,
                anchor:     this.options.titlePosition,
                titleSize:  this.options.titleSize,
                titleAlign: this.options.titleAlign
            });

            this.titlePanel.appendTo(this.basePanel); // Add it
        }
    },

    /**
     * Creates and initializes the legend panel,
     * if the legend is active.
     */
    initLegendPanel: function(){
        if (this.options.legend) {
            this.legendPanel = new pvc.LegendPanel(this, {
                anchor: this.options.legendPosition,
                legendSize: this.options.legendSize,
                align: this.options.legendAlign,
                minMarginX: this.options.legendMinMarginX,
                minMarginY: this.options.legendMinMarginY,
                textMargin: this.options.legendTextMargin,
                padding: this.options.legendPadding,
                textAdjust: this.options.legendTextAdjust,
                shape: this.options.legendShape,
                markerSize: this.options.legendMarkerSize,
                drawLine: this.options.legendDrawLine,
                drawMarker: this.options.legendDrawMarker
            });

            this.legendPanel.appendTo(this.basePanel); // Add it
        }
    },

    /**
     * Render the visualization.
     * If not pre-rendered, do it now.
     */
    render: function(bypassAnimation, rebuild) {
        try{
            this._renderAnimationStart = 
                this.isAnimating = this.options.animate && !bypassAnimation;
            
            if (!this.isPreRendered || rebuild) {
                this.preRender();
            }

            if (this.options.renderCallback) {
                this.options.renderCallback.call(this);
            }

            // When animating, renders the animation's 'start' point
            this.basePanel.getPvPanel().render();

            // Transition to the animation's 'end' point
            if (this.isAnimating) {
                this._renderAnimationStart = false;
                
                var me = this;
                this.basePanel.getPvPanel()
                        .transition()
                        .duration(2000)
                        .ease("cubic-in-out")
                        .start(function(){
                            me.isAnimating = false;
                            me._onRenderEnd(true);
                        });
            } else {
                this._onRenderEnd(false);
            }
        
        } catch (e) {
            if (e instanceof NoDataException) {

                if (!this.basePanel) {
                    pvc.log("No panel");
                    this.initBasePanel();
                }

                pvc.log("creating message");
                var pvPanel = this.basePanel.getPvPanel(), 
                    message = pvPanel.anchor("center").add(pv.Label);
                
                message.text("No data found");

                this.basePanel.extend(message, "noDataMessage_");
                
                pvPanel.render();

            } else {
                // We don't know how to handle this
                pvc.logError(e.message);
                throw e;
            }
        }
    },

    /**
     * Animation
     */
    animate: function(start, end) {
        return this._renderAnimationStart ? start : end;
    },
    
    /**
     * Called when a render has ended.
     * When the render performed an animation
     * and the 'animated' argument will have the value 'true'.
     *
     * The default implementation calls the base panel's
     * #_onRenderEnd method.
     * @virtual
     */
    _onRenderEnd: function(animated){
        this.basePanel._onRenderEnd(animated);
    },

    /**
     * Method to set the data to the chart.
     * Expected object is the same as what comes from the CDA: 
     * {metadata: [], resultset: []}
     */
    setData: function(data, options) {
        this.setResultset(data.resultset);
        this.setMetadata(data.metadata);

        $.extend(this.options, options);
    },

    /**
     * Sets the resultset that will be used to build the chart.
     */
    setResultset: function(resultset) {
        !this.parent || def.fail.operationInvalid("Can only set resultset on root chart.");
        this.resultset = resultset;
        if (resultset.length == 0) {
            pvc.log("Warning: Resultset is empty");
        }
    },

    /**
     * Sets the metadata that, optionally, 
     * will give more information for building the chart.
     */
    setMetadata: function(metadata) {
        !this.parent || def.fail.operationInvalid("Can only set resultset on root chart.");
        this.metadata = metadata;
        if (metadata.length == 0) {
            pvc.log("Warning: Metadata is empty");
        }
    },

    /**
     * This is the method to be used for the extension points
     * for the specific contents of the chart. already ge a pie
     * chart! Goes through the list of options and, if it
     * matches the prefix, execute that method on the mark.
     * WARNING: It's the user's responsibility to make sure that
     * unexisting methods don't blow this.
     */
    extend: function(mark, prefix, keyArgs) {
        // if mark is null or undefined, skip
        if(pvc.debug){
            pvc.log("Applying Extension Points for: '" + prefix +
                    "'" + (mark ? "" : "(target mark does not exist)"));
        }

        if (mark) {
            var points = this.options.extensionPoints;
            if(points){
                for (var p in points) {
                    // Starts with
                    if(p.indexOf(prefix) === 0){
                        var m = p.substring(prefix.length);

                        // Not everything that is passed to 'mark' argument
                        //  is actually a mark...(ex: scales)
                        // Not locked and
                        // Not intercepted and
                        if(mark.isLocked && mark.isLocked(m)){
                            pvc.log("* " + m + ": locked extension point!");
                        } else if(mark.isIntercepted && mark.isIntercepted(m)) {
                            pvc.log("* " + m + ":" + JSON.stringify(v) + " (controlled)");
                        } else {
                            var v = points[p];

                            if(pvc.debug){
                                pvc.log("* " + m + ": " + JSON.stringify(v));
                            }

                            // Distinguish between mark methods and properties
                            if (typeof mark[m] === "function") {
                                mark[m](v);
                            } else {
                                mark[m] = v;
                            }
                        }
                    }
                }
            }
        }
    },

    /**
     * Obtains the specified extension point.
     * Arguments are concatenated with '_'.
     */
    _getExtension: function(extPoint) {
        var points = this.options.extensionPoints;
        if(!points){
            return undefined; // ~warning
        }

        extPoint = pvc.arraySlice.call(arguments).join('_');
        return points[extPoint];
    },

    isOrientationVertical: function(orientation) {
        return (orientation || this.options.orientation) === "vertical";
    },

    isOrientationHorizontal: function(orientation) {
        return (orientation || this.options.orientation) == "horizontal";
    },

    /**
     * Converts a css-like shorthand margin string
     * to a margins object.
     *
     * <ol>
     *   <li> "1" - {all: 1}</li>
     *   <li> "1 2" - {top: 1, left: 2, right: 2, bottom: 1}</li>
     *   <li> "1 2 3" - {top: 1, left: 2, right: 2, bottom: 3}</li>
     *   <li> "1 2 3 4" - {top: 1, right: 2, bottom: 3, left: 4}</li>
     * </ol>
     */
    _parseMargins: function(margins){
        if(margins != null){
            if(typeof margins === 'string'){

                var comps = margins.split(/\s+/);
                switch(comps.length){
                    case 1:
                        margins = {all: comps[0]};
                        break;
                    case 2:
                        margins = {top: comps[0], left: comps[1], right: comps[1], bottom: comps[0]};
                        break;
                    case 3:
                        margins = {top: comps[0], left: comps[1], right: comps[1], bottom: comps[2]};
                        break;
                    case 4:
                        margins = {top: comps[0], right: comps[2], bottom: comps[3], left: comps[4]};
                        break;

                    default:
                        pvc.log("Invalid 'margins' option value: " + JSON.stringify(margins));
                        margins = null;
                }
            } else if (typeof margins === 'number') {
                margins = {all: margins};
            } else if (typeof margins !== 'object') {
                pvc.log("Invalid 'margins' option value: " + JSON.stringify(margins));
                margins = null;
            }
        }

        return margins;
    }
}, {
    // NOTE: undefined values are not considered by $.extend
    // and thus BasePanel does not receive null properties...
    defaultOptions: {
        canvas: null,

        width:  400,
        height: 300,
        
        multiChartLimit: null,
        multiChartWrapColumn: 3,
        
        orientation: 'vertical',
        
        extensionPoints:  undefined,
        
        roles:             undefined,
        dimensions:        undefined,
        readers:           undefined,
        crosstabMode:      true,
        multiChartColumnIndexes: undefined,
        multiChartRowIndexes: undefined,
        isMultiValued:     false,
        seriesInRows:      false,
        measuresIndexes:   undefined,
        dataOptions:       undefined,
        getCategoryLabel:  undefined,
        getSeriesLabel:    undefined,
        
        timeSeries:        undefined,
        timeSeriesFormat:  undefined,

        animate: true,

        title:         null,
        titlePosition: "top", // options: bottom || left || right
        titleAlign:    "center", // left / right / center
        titleSize:     undefined,

        legend:           false,
        legendPosition:   "bottom",
        legendSize:       undefined,
        legendAlign:      undefined,
        legendMinMarginX: undefined,
        legendMinMarginY: undefined,
        legendTextMargin: undefined,
        legendPadding:    undefined,
        legendTextAdjust: undefined,
        legendShape:      undefined,
        legendDrawLine:   undefined,
        legendDrawMarker: undefined,
        legendMarkerSize: undefined,
        
        colors: null,

        secondAxis: false,
        secondAxisIdx: -1,
        secondAxisColor: undefined,

        tooltipFormat: function(s, c, v, datum) {
            return s + ", " + c + ":  " + this.chart.options.valueFormat(v) +
                   (datum && datum.percent ? ( " (" + datum.percent.label + ")") : "");
        },

        valueFormat: function(d) {
            return pv.Format.number().fractionDigits(0, 2).format(d);
            // pv.Format.number().fractionDigits(0, 10).parse(d));
        },

        stacked: false,
        
        percentageNormalized: false,

        percentValueFormat: function(d){
            return pv.Format.number().fractionDigits(0, 2).format(d) + "%";
        },

        clickable:  false,
        selectable: false,

        clickAction: function(s, c, v) {
            pvc.log("You clicked on series " + s + ", category " + c + ", value " + v);
        },

        renderCallback: undefined,

        margins: undefined
    }
});