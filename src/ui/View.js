/*
 * Paper.js - The Swiss Army Knife of Vector Graphics Scripting.
 * http://paperjs.org/
 *
 * Copyright (c) 2011 - 2014, Juerg Lehni & Jonathan Puckey
 * http://scratchdisk.com/ & http://jonathanpuckey.com/
 *
 * Distributed under the MIT license. See LICENSE file for details.
 *
 * All rights reserved.
 */

/**
 * @name View
 *
 * @class The View object wraps an HTML element and handles drawing and user
 * interaction through mouse and keyboard for it. It offer means to scroll the
 * view, find the currently visible bounds in project coordinates, or the
 * center, both useful for constructing artwork that should appear centered on
 * screen.
 */
var View = Base.extend(Callback, /** @lends View# */{
	_class: 'View',

	initialize: function View(element) {
		// Store reference to the currently active global paper scope, and the
		// active project, which will be represented by this view
		this._scope = paper;
		this._project = paper.project;
		this._element = element;
		var size;
/*#*/ if (__options.environment == 'browser') {
		// Generate an id for this view / element if it does not have one
		this._id = element.getAttribute('id');
		if (this._id == null)
			element.setAttribute('id', this._id = 'view-' + View._id++);
		// Install event handlers
		DomEvent.add(element, this._viewHandlers);
		// If the element has the resize attribute, resize the it to fill the
		// window and resize it again whenever the user resizes the window.
		if (PaperScope.hasAttribute(element, 'resize')) {
			// Subtract element' viewport offset from the total size, to
			// stretch it in
			var offset = DomElement.getOffset(element, true),
				that = this;
			size = DomElement.getViewportBounds(element)
					.getSize().subtract(offset);
			this._windowHandlers = {
				resize: function() {
					// Only update element offset if it's not invisible, as
					// otherwise the offset would be wrong.
					if (!DomElement.isInvisible(element))
						offset = DomElement.getOffset(element, true);
					// Set the size now, which internally calls onResize
					// and redraws the view
					that.setViewSize(DomElement.getViewportBounds(element)
							.getSize().subtract(offset));
				}
			};
			DomEvent.add(window, this._windowHandlers);
		} else {
			// Try visible size first, since that will help handling previously
			// scaled canvases (e.g. when dealing with ratio)
			size = DomElement.getSize(element);
			// If the element is invisible, we cannot directly access
			// element.width / height, because they would appear 0.
			// Reading the attributes should still work.
			if (size.isNaN() || size.isZero())
				size = new Size(parseInt(element.getAttribute('width'), 10),
							parseInt(element.getAttribute('height'), 10));
		}
		// Set canvas size even if we just deterined the size from it, since
		// it might have been set to a % size, in which case it would use some
		// default internal size (300x150 on WebKit) and scale up the pixels.
		// We also need this call here for HiDPI support.
		this._setViewSize(size);
		// TODO: Test this on IE:
		if (PaperScope.hasAttribute(element, 'stats')
				&& typeof Stats !== 'undefined') {
			this._stats = new Stats();
			// Align top-left to the element
			var stats = this._stats.domElement,
				style = stats.style,
				offset = DomElement.getOffset(element);
			style.position = 'absolute';
			style.left = offset.x + 'px';
			style.top = offset.y + 'px';
			document.body.appendChild(stats);
		}
/*#*/ } else if (__options.environment == 'node') {
		// Generate an id for this view
		this._id = 'view-' + View._id++;
		size = new Size(element.width, element.height);
/*#*/ } // __options.environment == 'node'
		// Keep track of views internally
		View._views.push(this);
		// Link this id to our view
		View._viewsById[this._id] = this;
		this._viewSize = size;
		(this._matrix = new Matrix())._owner = this;
		this._zoom = 1;
		// Make sure the first view is focused for keyboard input straight away
		if (!View._focused)
			View._focused = this;
		// Items that need the onFrame handler called on them
		this._frameItems = {};
		this._frameItemCount = 0;
	},

	/**
	 * Removes this view from the project and frees the associated element.
	 */
	remove: function() {
		if (!this._project)
			return false;
		// Clear focus if removed view had it
		if (View._focused === this)
			View._focused = null;
		// Remove view from internal structures
		View._views.splice(View._views.indexOf(this), 1);
		delete View._viewsById[this._id];
		// Unlink from project
		if (this._project.view == this)
			this._project.view = null;
/*#*/ if (__options.environment == 'browser') {
		// Uninstall event handlers again for this view.
		DomEvent.remove(this._element, this._viewHandlers);
		DomEvent.remove(window, this._windowHandlers);
/*#*/ } // __options.environment == 'browser'
		this._element = this._project = null;
		// Remove all onFrame handlers.
		// TODO: Shouldn't we remove all handlers, automatically
		this.detach('frame');
		this._animate = false;
		this._frameItems = {};
		return true;
	},

	/**
	 * @namespace
	 * @ignore
	 */
	_events: {
		/**
		 * @namespace
		 * @ignore
		 */
		onFrame: {
			install: function() {
				this.play();
			},

			uninstall: function() {
				this.pause();
			}
		},

		onResize: {}
	},

	// These are default values for event related properties on the prototype. 
	// Writing item._count++ does not change the defaults, it creates / updates
	// the property on the instance. Useful!
	_animate: false,
	_time: 0,
	_count: 0,

	_requestFrame: function() {
/*#*/ if (__options.environment == 'browser') {
		var that = this;
		DomEvent.requestAnimationFrame(function() {
			that._requested = false;
			// Do we need to stop due to a call to the frame event's uninstall()
			if (!that._animate)
				return;
			// Request next frame already before handling the current frame
			that._requestFrame();
			that._handleFrame();
		}, this._element);
		this._requested = true;
/*#*/ } // __options.environment == 'browser'
	},

	_handleFrame: function() {
		// Set the global paper object to the current scope
		paper = this._scope;
		var now = Date.now() / 1000,
			delta = this._before ? now - this._before : 0;
		this._before = now;
		this._handlingFrame = true;
		// Use new Base() to convert into a Base object, for #toString()
		this.fire('frame', new Base({
			// Time elapsed since last redraw in seconds:
			delta: delta,
			// Time since first call of frame() in seconds:
			time: this._time += delta,
			count: this._count++
		}));
		// Update framerate stats
		if (this._stats)
			this._stats.update();
		this._handlingFrame = false;
		// Automatically update view on each frame.
		this.update();
	},

	_animateItem: function(item, animate) {
		var items = this._frameItems;
		if (animate) {
			items[item._id] = {
				item: item,
				// Additional information for the event callback
				time: 0,
				count: 0
			};
			if (++this._frameItemCount === 1)
				this.attach('frame', this._handleFrameItems);
		} else {
			delete items[item._id];
			if (--this._frameItemCount === 0) {
				// If this is the last one, just stop animating straight away.
				this.detach('frame', this._handleFrameItems);
			}
		}
	},

	// Handles _frameItems and fires the 'frame' event on them.
	_handleFrameItems: function(event) {
		for (var i in this._frameItems) {
			var entry = this._frameItems[i];
			entry.item.fire('frame', new Base(event, {
				// Time since first call of frame() in seconds:
				time: entry.time += event.delta,
				count: entry.count++
			}));
		}
	},

	_update: function() {
		this._project._needsUpdate = true;
		if (this._handlingFrame)
			return;
		if (this._animate) {
			// If we're animating, call _handleFrame staight away, but without
			// requesting another animation frame.
			this._handleFrame();
		} else {
			// Otherwise simply update the view now
			this.update();
		}
	},

	/**
	 * Private notifier that is called whenever a change occurs in this view.
	 * Used only by Matrix for now.
	 *
	 * @param {ChangeFlag} flags describes what exactly has changed.
	 */
	_changed: function(flags) {
		if (flags & /*#=*/ ChangeFlag.APPEARANCE)
			this._project._needsUpdate = true;
	},

	_transform: function(matrix) {
		this._matrix.concatenate(matrix);
		// Force recalculation of these values next time they are requested.
		this._bounds = null;
		this._update();
	},

	/**
	 * The underlying native element.
	 *
	 * @type HTMLCanvasElement
	 * @bean
	 */
	getElement: function() {
		return this._element;
	},

	/**
	 * The size of the view. Changing the view's size will resize it's
	 * underlying element.
	 *
	 * @type Size
	 * @bean
	 */
	getViewSize: function() {
		var size = this._viewSize;
		return new LinkedSize(size.width, size.height, this, 'setViewSize');
	},

	setViewSize: function(size) {
		size = Size.read(arguments);
		var delta = size.subtract(this._viewSize);
		if (delta.isZero())
			return;
		this._viewSize.set(size.width, size.height);
		this._setViewSize(size);
		this._bounds = null; // Force recalculation
		// Call onResize handler on any size change
		this.fire('resize', {
			size: size,
			delta: delta
		});
		this._update();
	},

	/**
	 * Private method, overriden in CanvasView for HiDPI support.
	 */
	_setViewSize: function(size) {
		var element = this._element;
		element.width = size.width;
		element.height = size.height;
	},

	/**
	 * The bounds of the currently visible area in project coordinates.
	 *
	 * @type Rectangle
	 * @bean
	 */
	getBounds: function() {
		if (!this._bounds)
			this._bounds = this._matrix.inverted()._transformBounds(
					new Rectangle(new Point(), this._viewSize));
		return this._bounds;
	},

	/**
	 * The size of the visible area in project coordinates.
	 *
	 * @type Size
	 * @bean
	 */
	getSize: function(/* dontLink */) {
		return this.getBounds().getSize(arguments[0]);
	},

	/**
	 * The center of the visible area in project coordinates.
	 *
	 * @type Point
	 * @bean
	 */
	getCenter: function(/* dontLink */) {
		return this.getBounds().getCenter(arguments[0]);
	},

	setCenter: function(center) {
		// We need to use center to avoid minification issues and prevent method
		// from turning into a bean (by removal of the center argument).
		center = Point.read(arguments);
		this.scrollBy(center.subtract(this.getCenter()));
	},

	/**
	 * The zoom factor by which the project coordinates are magnified.
	 *
	 * @type Number
	 * @bean
	 */
	getZoom: function() {
		return this._zoom;
	},

	setZoom: function(zoom) {
		// TODO: Clamp the view between 1/32 and 64, just like Illustrator?
		this._transform(new Matrix().scale(zoom / this._zoom,
			this.getCenter()));
		this._zoom = zoom;
	},

	/**
	 * Checks whether the view is currently visible within the current browser
	 * viewport.
	 *
	 * @return {Boolean} whether the view is visible.
	 */
	isVisible: function() {
		return DomElement.isInView(this._element);
	},

	/**
	 * Scrolls the view by the given vector.
	 *
	 * @param {Point} point
	 */
	scrollBy: function(/* point */) {
		this._transform(new Matrix().translate(Point.read(arguments).negate()));
	},

	/**
	 * Makes all animation play by adding the view to the request animation
	 * loop.
	 */
	play: function() {
		this._animate = true;
/*#*/ if (__options.environment == 'browser') {
		// Request a frame handler straight away to initialize the
		// sequence of onFrame calls.
		if (!this._requested)
			this._requestFrame();
/*#*/ } // __options.environment == 'browser'
	},

	/**
	 * Makes all animation pause by removing the view to the request animation
	 * loop.
	 */
	pause: function() {
		this._animate = false;
	},

	/**
	 * Updates the view if there are changes. Note that when using built-in
	 * event hanlders for interaction, animation and load events, this method is
	 * invoked for you automatically at the end.
	 *
	 * @name View#update
	 * @function
	 */
	// update: function() {
	// },

	/**
	 * Updates the view if there are changes.
	 *
	 * @deprecated use {@link #update()} instead.
	 */
	draw: function() {
		this.update();
	},

	// TODO: getInvalidBounds
	// TODO: invalidate(rect)
	// TODO: style: artwork / preview / raster / opaque / ink
	// TODO: getShowGrid
	// TODO: getMousePoint
	// TODO: projectToView(rect)

	// DOCS: projectToView(point), viewToProject(point)
	projectToView: function(/* point */) {
		return this._matrix._transformPoint(Point.read(arguments));
	},

	viewToProject: function(/* point */) {
		return this._matrix._inverseTransform(Point.read(arguments));
	}

	/**
	 * {@grouptitle Event Handlers}
	 * Handler function to be called on each frame of an animation.
	 * The function receives an event object which contains information about
	 * the frame event:
	 *
	 * <b>{@code event.count}</b>: the number of times the frame event was
	 * fired.
	 * <b>{@code event.time}</b>: the total amount of time passed since the
	 * first frame event in seconds.
	 * <b>{@code event.delta}</b>: the time passed in seconds since the last
	 * frame event.
	 *
	 * @example {@paperscript}
	 * // Creating an animation:
	 *
	 * // Create a rectangle shaped path with its top left point at:
	 * // {x: 50, y: 25} and a size of {width: 50, height: 50}
	 * var path = new Path.Rectangle(new Point(50, 25), new Size(50, 50));
	 * path.fillColor = 'black';
	 *
	 * function onFrame(event) {
	 * 	// Every frame, rotate the path by 3 degrees:
	 * 	path.rotate(3);
	 * }
	 *
	 * @name View#onFrame
	 * @property
	 * @type Function
	 */

	/**
	 * Handler function that is called whenever a view is resized.
	 *
	 * @example
	 * // Repositioning items when a view is resized:
	 *
	 * // Create a circle shaped path in the center of the view:
	 * var path = new Path.Circle(view.bounds.center, 30);
	 * path.fillColor = 'red';
	 *
	 * function onResize(event) {
	 * 	// Whenever the view is resized, move the path to its center:
	 * 	path.position = view.center;
	 * }
	 *
	 * @name View#onResize
	 * @property
	 * @type Function
	 */
	/**
	 * {@grouptitle Event Handling}
	 * 
	 * Attach an event handler to the view.
	 *
	 * @name View#attach
	 * @alias View#on
	 * @function
	 * @param {String('frame', 'resize')} type the event type
	 * @param {Function} function The function to be called when the event
	 * occurs
	 * 
	 * @example {@paperscript}
	 * // Create a rectangle shaped path with its top left point at:
	 * // {x: 50, y: 25} and a size of {width: 50, height: 50}
	 * var path = new Path.Rectangle(new Point(50, 25), new Size(50, 50));
	 * path.fillColor = 'black';
	 * 
	 * var frameHandler = function(event) {
	 * 	// Every frame, rotate the path by 3 degrees:
	 * 	path.rotate(3);
	 * };
	 * 
	 * view.on('frame', frameHandler);
	 */
	/**
	 * Attach one or more event handlers to the view.
	 *
	 * @name View#attach
	 * @alias View#on
	 * @function
	 * @param {Object} param an object literal containing one or more of the
	 * following properties: {@code frame, resize}.
	 * // Create a rectangle shaped path with its top left point at:
	 * // {x: 50, y: 25} and a size of {width: 50, height: 50}
	 * var path = new Path.Rectangle(new Point(50, 25), new Size(50, 50));
	 * path.fillColor = 'black';
	 * 
	 * var frameHandler = function(event) {
	 * 	// Every frame, rotate the path by 3 degrees:
	 * 	path.rotate(3);
	 * };
	 * 
	 * view.on({
	 * 	frame: frameHandler
	 * });
	 */

	/**
	 * Detach an event handler from the view.
	 *
	 * @name View#detach
	 * @alias View#off
	 * @function
	 * @param {String('frame', 'resize')} type the event type
	 * @param {Function} function The function to be detached
	 * 
	 * @example {@paperscript}
	 * // Create a rectangle shaped path with its top left point at:
	 * // {x: 50, y: 25} and a size of {width: 50, height: 50}
	 * var path = new Path.Rectangle(new Point(50, 25), new Size(50, 50));
	 * path.fillColor = 'black';
	 * 
	 * var frameHandler = function(event) {
	 * 	// Every frame, rotate the path by 3 degrees:
	 * 	path.rotate(3);
	 * };
	 * 
	 * view.on({
	 * 	frame: frameHandler
	 * });
	 * 
	 * // When the user presses the mouse,
	 * // detach the frame handler from the view:
	 * function onMouseDown(event) {
	 * 	view.detach('frame');
	 * }
	 */
	/**
	 * Detach one or more event handlers from the view.
	 *
	 * @name View#detach
	 * @alias View#off
	 * @function
	 * @param {Object} param an object literal containing one or more of the
	 * following properties: {@code frame, resize}
	 */

	/**
	 * Fire an event on the view.
	 *
	 * @name View#fire
	 * @alias View#trigger
	 * @function
	 * @param {String('frame', 'resize')} type the event type
	 * @param {Object} event an object literal containing properties describing
	 * the event.
	 */

	/**
	 * Check if the view has one or more event handlers of the specified type.
	 *
	 * @name View#responds
	 * @function
	 * @param {String('frame', 'resize')} type the event type
	 * @return {Boolean} {@true if the view has one or more event handlers of
	 * the specified type}
	 */
}, {
	statics: {
		_views: [],
		_viewsById: {},
		_id: 0,

		create: function(element) {
/*#*/ if (__options.environment == 'browser') {
			if (typeof element === 'string')
				element = document.getElementById(element);
/*#*/ } // __options.environment == 'browser'
			// Factory to provide the right View subclass for a given element.
			// Produces only CanvasViews for now:
			return new CanvasView(element);
		}
	}
}, new function() {
	// Injection scope for mouse events on the browser
/*#*/ if (__options.environment == 'browser') {
	var tool,
		prevFocus,
		tempFocus,
		dragging = false;

	function getView(event) {
		// Get the view from the current event target.
		var target = DomEvent.getTarget(event);
		// Some node do not have the getAttribute method, e.g. SVG nodes.
		return target.getAttribute && View._viewsById[target.getAttribute('id')];
	}

	function viewToProject(view, event) {
		return view.viewToProject(DomEvent.getOffset(event, view._element));
	}

	function updateFocus() {
		if (!View._focused || !View._focused.isVisible()) {
			// Find the first visible view
			for (var i = 0, l = View._views.length; i < l; i++) {
				var view = View._views[i];
				if (view && view.isVisible()) {
					View._focused = tempFocus = view;
					break;
				}
			}
		}
	}

	function mousedown(event) {
		// Get the view from the event, and store a reference to the view that
		// should receive keyboard input.
		var view = View._focused = getView(event),
			point = viewToProject(view, event);
		dragging = true;
		// Always first call the view's mouse handlers, as required by
		// CanvasView, and then handle the active tool, if any.
		view._handleEvent('mousedown', point, event);
		if (tool = view._scope.tool)
			tool._handleEvent('mousedown', point, event);
		// In the end we always call update(), which only updates the view if
		// anything has changed in the above calls.
		view.update();
	}

	function handleMouseMove(view, point, event) {
		view._handleEvent('mousemove', point, event);
		var tool = view._scope.tool;
		if (tool) {
			// If there's no onMouseDrag, fire onMouseMove while dragging.
			tool._handleEvent(dragging && tool.responds('mousedrag')
					? 'mousedrag' : 'mousemove', point, event);
		}
		view.update();
		return tool;
	}

	function mousemove(event) {
		var view = View._focused;
		if (!dragging) {
			// See if we can get the view from the current event target, and
			// handle the mouse move over it.
			var target = getView(event);
			if (target) {
				// Temporarily focus this view without making it sticky, so
				// Key events are handled too during the mouse over
				// If we switch view, fire one last mousemove in the old view,
				// to give items the change to receive a mouseleave, etc.
				if (view !== target)
					handleMouseMove(view, viewToProject(view, event), event);
				prevFocus = view;
				view = View._focused = tempFocus = target;
			} else if (tempFocus && tempFocus === view) {
				// Clear temporary focus again and update it.
				view = View._focused = prevFocus;
				updateFocus();
			}
		}
		if (view) {
			var point = viewToProject(view, event);
			if (dragging || view.getBounds().contains(point))
				tool = handleMouseMove(view, point, event);
		}
	}

	function mouseout(event) {
		// When the moues leaves the document, fire one last mousemove event,
		// to give items the change to receive a mouseleave, etc.
		var view = View._focused,
			target = DomEvent.getRelatedTarget(event);
		if (view && (!target || target.nodeName === 'HTML'))
			handleMouseMove(view, viewToProject(view, event), event);
	}

	function mouseup(event) {
		var view = View._focused;
		if (!view || !dragging)
			return;
		var point = viewToProject(view, event);
		curPoint = null;
		dragging = false;
		view._handleEvent('mouseup', point, event);
		if (tool)
			tool._handleEvent('mouseup', point, event);
		view.update();
	}

	function selectstart(event) {
		// Only stop this even if we're dragging already, since otherwise no
		// text whatsoever can be selected on the page.
		if (dragging)
			event.preventDefault();
	}

	// mousemove and mouseup events need to be installed on document, not the
	// view element, since we want to catch the end of drag events even outside
	// our view. Only the mousedown events are installed on the view, as handled
	// by _createHandlers below.

	DomEvent.add(document, {
		mousemove: mousemove,
		mouseout: mouseout,
		mouseup: mouseup,
		touchmove: mousemove,
		touchend: mouseup,
		selectstart: selectstart,
		scroll: updateFocus
	});

	DomEvent.add(window, {
		load: updateFocus
	});

	return {
		_viewHandlers: {
			mousedown: mousedown,
			touchstart: mousedown,
			selectstart: selectstart
		},

		// To be defined in subclasses
		_handleEvent: function(/* type, point, event */) {},

		statics: {
			/**
			 * Loops through all views and sets the focus on the first
			 * active one.
			 */
			updateFocus: updateFocus
		}
	};
/*#*/ } // __options.environment == 'browser'
});
