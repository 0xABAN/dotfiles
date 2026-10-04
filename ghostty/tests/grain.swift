// Run on macOS: swift -suppress-warnings ghostty/tests/grain.swift
// Use the system's deprecated OpenGL API to test actual GLSL without dependencies.
import AppKit
import OpenGL.GL3

let format = NSOpenGLPixelFormat(attributes: [
    UInt32(NSOpenGLPFAOpenGLProfile), UInt32(NSOpenGLProfileVersion3_2Core), 0,
])!
let context = NSOpenGLContext(format: format, share: nil)!
context.makeCurrentContext()

func compile(_ type: GLenum, _ source: String) -> GLuint {
    let shader = glCreateShader(type)
    source.withCString { pointer in
        var pointer: UnsafePointer<GLchar>? = pointer
        glShaderSource(shader, 1, &pointer, nil)
    }
    glCompileShader(shader)
    var passed: GLint = 0
    glGetShaderiv(shader, GLenum(GL_COMPILE_STATUS), &passed)
    var log = [GLchar](repeating: 0, count: 4096)
    glGetShaderInfoLog(shader, GLsizei(log.count), nil, &log)
    precondition(passed != 0, String(cString: log))
    return shader
}

let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../shaders/grain.glsl")
let grain = try String(contentsOf: path, encoding: .utf8)
let program = glCreateProgram()
glAttachShader(program, compile(GLenum(GL_VERTEX_SHADER), """
#version 150
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"""))
glAttachShader(program, compile(GLenum(GL_FRAGMENT_SHADER), """
#version 150
uniform sampler2D iChannel0;
uniform vec3 iResolution;
out vec4 outputColor;
\(grain)
void main() { mainImage(outputColor, gl_FragCoord.xy); }
"""))
glLinkProgram(program)
var linked: GLint = 0
glGetProgramiv(program, GLenum(GL_LINK_STATUS), &linked)
precondition(linked != 0, "Shader program did not link")
glUseProgram(program)
glUniform3f(glGetUniformLocation(program, "iResolution"), 16, 16, 1)

// An offscreen float framebuffer preserves alpha and avoids display color transforms.
var target: GLuint = 0
var input: GLuint = 0
var framebuffer: GLuint = 0
var vertices: GLuint = 0
glGenVertexArrays(1, &vertices)
glBindVertexArray(vertices)
glGenTextures(1, &target)
glBindTexture(GLenum(GL_TEXTURE_2D), target)
glTexImage2D(GLenum(GL_TEXTURE_2D), 0, GL_RGBA32F, 16, 16, 0, GLenum(GL_RGBA), GLenum(GL_FLOAT), nil)
glGenFramebuffers(1, &framebuffer)
glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)
glFramebufferTexture2D(GLenum(GL_FRAMEBUFFER), GLenum(GL_COLOR_ATTACHMENT0), GLenum(GL_TEXTURE_2D), target, 0)
precondition(glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER)) == GLenum(GL_FRAMEBUFFER_COMPLETE))
glGenTextures(1, &input)
glBindTexture(GLenum(GL_TEXTURE_2D), input)
glTexParameteri(GLenum(GL_TEXTURE_2D), GLenum(GL_TEXTURE_MIN_FILTER), GL_NEAREST)
glTexParameteri(GLenum(GL_TEXTURE_2D), GLenum(GL_TEXTURE_MAG_FILTER), GL_NEAREST)
glViewport(0, 0, 16, 16)

for sample: [Float] in [[0, 0, 0, 0], [0.2, 0.3, 0.1, 0.5], [0.1, 0.1, 0.1, 0.92], [0.4, 0.8, 0.6, 1]] {
    glTexImage2D(GLenum(GL_TEXTURE_2D), 0, GL_RGBA32F, 1, 1, 0, GLenum(GL_RGBA), GLenum(GL_FLOAT), sample)
    glDrawArrays(GLenum(GL_TRIANGLES), 0, 3)
    var pixels = [Float](repeating: 0, count: 16 * 16 * 4)
    glReadPixels(0, 0, 16, 16, GLenum(GL_RGBA), GLenum(GL_FLOAT), &pixels)
    precondition(glGetError() == GLenum(GL_NO_ERROR))
    let addedAlpha = (1 - sample[3]) * 0.006
    for offset in stride(from: 0, to: pixels.count, by: 4) {
        precondition(abs(pixels[offset + 3] - sample[3] - addedAlpha) < 0.00001)
        for channel in 0..<3 {
            let addedColor = pixels[offset + channel] - sample[channel]
            precondition(addedColor >= -0.00001 && addedColor <= addedAlpha + 0.00001)
            precondition(abs(addedColor - (pixels[offset] - sample[0])) < 0.00001)
        }
    }
    if sample[3] == 0 {
        let values = stride(from: 0, to: pixels.count, by: 4).map { pixels[$0] }
        precondition(values.max()! - values.min()! > 0.001, "Grain must vary across pixels")
    }
}
print("PASS: GLSL compiles; grain is premultiplied, faint, monochrome, and behind opaque text")
