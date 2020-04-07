import React from 'react';

class PatternView extends React.Component {
    build() {
        this.props.factory.buildSubFactory(this.props.pattern);
    }

    render() {
        return (
            <div>
                <div>{this.props.pattern.id} {this.props.pattern.name}</div>
                <button className="btn btn-success" onClick={() => this.build()}>Build</button>
            </div>
        );
    }
}
export default PatternView;
