import React from 'react';
import Factory from '../Game/Factory';
import Pattern from '../Game/Pattern';

interface PatternProps {
    factory: Factory,
    pattern: Pattern
}

class PatternView extends React.Component<PatternProps> {
    build() {
        this.props.factory.buildSubFactory(this.props.pattern);
    }

    render() {
        return (
            <div>
                <div>{this.props.pattern.name}</div>
                <button className="btn btn-success" onClick={() => this.build()}>Build</button>
            </div>
        );
    }
}
export default PatternView;
